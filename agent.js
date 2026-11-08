import { validateArgs } from './tools.js'

export async function runAgent(request, { brain, tools, state, maxSteps = 6, onStep = () => {} } = {}) {
  const ctx = { request, results: {}, step: 0 }
  const run = { requestId: request.id, status: 'running', steps: [], startedAt: new Date().toISOString() }
  state.runs.set(request.id, run)
  for (let step = 0; step < maxSteps; step += 1) {
    ctx.step = step
    const chosen = await brain.decide(ctx)
    const decision = chosen.decision ?? chosen
    const brainName = chosen.brain ?? brain.name ?? 'rules'
    if (decision.final) { run.status = 'completed'; run.final = decision.final; break }
    const validation = validateArgs(decision.tool, decision.args)
    const record = { step: step + 1, thought: decision.thought, tool: decision.tool, args: decision.args, brain: brainName, at: new Date().toISOString() }
    state.audit.push({ time: record.at, requestId: request.id, tool: decision.tool, argsSummary: JSON.stringify(decision.args).slice(0, 240), who: 'agent' })
    if (!validation.ok) { record.error = validation.errors; run.steps.push(record); run.status = 'error'; await onStep(record, run); break }
    try {
      const result = tools.execute(decision.tool, decision.args, { requestId: request.id }, state)
      record.result = result
      ctx.results[decision.tool] = result
      run.steps.push(record)
      await onStep(record, run)
      if (result.approvalId) { run.status = 'waiting_approval'; run.approvalId = result.approvalId; break }
      if (decision.tool === 'create_ticket' || decision.tool === 'escalate_to_human') { run.status = decision.tool === 'escalate_to_human' ? 'escalated' : 'completed'; break }
    } catch (error) {
      record.error = error.message
      run.steps.push(record)
      run.status = 'error'
      await onStep(record, run)
      break
    }
  }
  if (run.status === 'running') run.status = 'max_steps'
  run.finishedAt = new Date().toISOString()
  return run
}
