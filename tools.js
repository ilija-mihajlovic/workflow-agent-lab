const schemas = {
  classify_request: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 } } },
  lookup_order: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^ORD-[0-9]{4}$' } } },
  check_refund_policy: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string', pattern: '^ORD-[0-9]{4}$' } } },
  draft_reply: { type: 'object', required: ['tone', 'text'], properties: { tone: { type: 'string', enum: ['warm', 'clear', 'empathetic', 'firm'] }, text: { type: 'string', minLength: 1, maxLength: 1200 } } },
  create_ticket: { type: 'object', required: ['title', 'priority', 'reason'], properties: { title: { type: 'string', minLength: 1 }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, reason: { type: 'string', minLength: 1 } } },
  issue_refund: { type: 'object', required: ['orderId', 'amount', 'reason'], properties: { orderId: { type: 'string', pattern: '^ORD-[0-9]{4}$' }, amount: { type: 'number', minimum: 0.01 }, reason: { type: 'string', minLength: 1 } } },
  send_reply: { type: 'object', required: ['requestId', 'text'], properties: { requestId: { type: 'string', pattern: '^REQ-[0-9]{3}$' }, text: { type: 'string', minLength: 1, maxLength: 1200 } } },
  escalate_to_human: { type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 1 }, flag: { type: 'string' } } }
}

const INJECTION_PATTERNS = [/ignore (all|any|previous|your) rules?/i, /system prompt/i, /developer message/i, /jailbreak/i, /reveal (your|the) instructions/i]

export function validateArgs(tool, args) {
  const schema = schemas[tool]
  if (!schema || !args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, errors: ['unknown tool or arguments are not an object'] }
  const errors = []
  for (const key of schema.required ?? []) if (!(key in args)) errors.push(`missing ${key}`)
  for (const [key, rule] of Object.entries(schema.properties ?? {})) {
    if (!(key in args)) continue
    const value = args[key]
    if (rule.type === 'string' && typeof value !== 'string') errors.push(`${key} must be a string`)
    if (rule.type === 'number' && typeof value !== 'number') errors.push(`${key} must be a number`)
    if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) errors.push(`${key} is too short`)
    if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) errors.push(`${key} is too long`)
    if (rule.minimum && typeof value === 'number' && value < rule.minimum) errors.push(`${key} is below minimum`)
    if (rule.enum && !rule.enum.includes(value)) errors.push(`${key} is not an allowed value`)
    if (rule.pattern && typeof value === 'string' && !new RegExp(rule.pattern).test(value)) errors.push(`${key} has an invalid format`)
  }
  return { ok: errors.length === 0, errors }
}

export function detectInjection(text = '') {
  const matches = INJECTION_PATTERNS.filter(pattern => pattern.test(text)).map(pattern => pattern.source)
  return { flagged: matches.length > 0, matches }
}

function audit(state, requestId, tool, args, who = 'agent') {
  state.audit.push({ time: new Date().toISOString(), requestId, tool, argsSummary: JSON.stringify(args).slice(0, 240), who })
}

function queueApproval(state, requestId, tool, args) {
  const id = `APR-${String(state.approvals.length + 1).padStart(3, '0')}`
  state.approvals.push({ id, requestId, tool, args, status: 'pending', createdAt: new Date().toISOString() })
  return { queued: true, approvalId: id, message: 'Waiting for human approval' }
}

export function createToolBox({ requests = [], orders = [] } = {}) {
  const requestMap = new Map(requests.map(item => [item.id, item]))
  const orderMap = new Map(orders.map(item => [item.id, item]))
  return {
    schemas,
    execute(tool, args, context, state) {
      const checked = validateArgs(tool, args)
      if (!checked.ok) throw new Error(`Invalid ${tool} arguments: ${checked.errors.join(', ')}`)
      const requestId = context.requestId
      if (tool === 'classify_request') {
        const injection = detectInjection(args.text)
        const text = args.text.toLowerCase()
        let category = 'general_question'
        if (injection.flagged) category = 'prompt_injection'
        else if (/refund|money back|return/.test(text)) category = 'refund'
        else if (/address|delivery address/.test(text)) category = 'address_change'
        else if (/damaged|broken|arrived.*(crack|damage)/.test(text)) category = 'damaged_item'
        else if (/where.*(order|ord-[0-9]{4})|status|track|shipped|delivery/.test(text)) category = 'order_status'
        else if (/invoice|receipt|vat/.test(text)) category = 'invoice'
        else if (/buy now|casino|crypto|unsubscribe|seo service/.test(text)) category = 'spam'
        const urgency = /angry|furious|unacceptable|lawsuit|asap|urgent/i.test(args.text) ? 'high' : 'normal'
        return { category, urgency, injectionFlagged: injection.flagged, matches: injection.matches }
      }
      if (tool === 'lookup_order') return orderMap.get(args.id) ?? { found: false, id: args.id }
      if (tool === 'check_refund_policy') {
        const order = orderMap.get(args.orderId)
        if (!order) return { eligible: false, reason: 'Order not found' }
        const daysSinceDelivery = Math.max(0, Math.floor((Date.now() - new Date(order.deliveredAt).getTime()) / 86400000))
        const withinWindow = daysSinceDelivery <= 30
        const damaged = requestMap.get(requestId)?.category === 'damaged_item' || /damaged|broken/i.test(requestMap.get(requestId)?.text ?? '')
        const overLimit = order.total > 150
        return { eligible: (withinWindow || damaged) && !overLimit, withinWindow, damaged, overLimit, amount: order.total, reason: overLimit ? 'Amount is over the human approval limit' : withinWindow || damaged ? 'Policy allows refund' : 'Outside the 30 day window' }
      }
      if (tool === 'draft_reply') return { drafted: true, tone: args.tone, preview: args.text }
      if (tool === 'create_ticket') return { created: true, ticketId: `TCK-${String(state.audit.length).padStart(3, '0')}`, priority: args.priority }
      if (tool === 'issue_refund' || tool === 'send_reply') return queueApproval(state, requestId, tool, args)
      if (tool === 'escalate_to_human') { state.escalated.add(requestId); return { escalated: true, reason: args.reason, flag: args.flag ?? null } }
      throw new Error(`Unknown tool ${tool}`)
    }
  }
}

export function approve(state, approvalId, decision, who = 'human') {
  const item = state.approvals.find(entry => entry.id === approvalId)
  if (!item || item.status !== 'pending') return { ok: false, error: 'Approval not found or already decided' }
  item.status = decision
  item.decidedAt = new Date().toISOString()
  item.decidedBy = who
  audit(state, item.requestId, item.tool, item.args, who)
  if (decision === 'approved') item.result = { executed: true, tool: item.tool, reference: `${item.tool === 'send_reply' ? 'MSG' : 'REF'}-${item.id.slice(4)}` }
  return { ok: true, item }
}

export const toolSchemas = schemas
