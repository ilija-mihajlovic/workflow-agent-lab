const $ = selector => document.querySelector(selector)
let state = { requests: [], runs: [], approvals: [], audit: [], counters: {} }
let selected = null
let activeTab = 'approvals'

async function refresh() {
  const response = await fetch('/api/state')
  state = await response.json()
  renderInbox()
  renderSelected()
  renderApprovals()
  renderAudit()
  for (const key of ['handled', 'waiting', 'escalated']) $(`[data-counter="${key}"]`).textContent = state.counters[key] ?? 0
  $('#approval-count').textContent = state.counters.waiting ?? 0
}
function runFor(id) { return state.runs.find(run => run.requestId === id) }
function requestFor(id) { return state.requests.find(request => request.id === id) }
function renderInbox() {
  $('#request-list').innerHTML = state.requests.map(request => {
    const run = runFor(request.id)
    const category = run?.steps?.[0]?.result?.category
    const flagged = run?.steps?.[0]?.result?.injectionFlagged
    return `<button class="request ${selected === request.id ? 'selected' : ''}" data-request="${request.id}"><span class="request-top"><strong>${request.id}</strong><span class="status ${run?.status ?? 'new'}">${run?.status?.replace('_', ' ') ?? 'new'}</span></span><span class="request-customer">${request.customer}</span><span class="request-text">${request.text}</span><span class="badges">${category ? `<span class="badge">${category.replace('_', ' ')}</span>` : ''}${flagged ? '<span class="badge danger">flagged</span>' : ''}</span></button>`
  }).join('')
  document.querySelectorAll('[data-request]').forEach(button => button.addEventListener('click', () => { selected = button.dataset.request; renderInbox(); renderSelected() }))
}
function renderSelected() {
  const request = requestFor(selected)
  const run = runFor(selected)
  $('#run-one').disabled = !request || run?.status === 'running'
  $('#selected-title').textContent = request ? `${request.id} · ${request.customer}` : 'Select a request'
  if (!request) return
  if (!run) { $('#timeline-content').innerHTML = `<div class="context-card"><p class="eyebrow">CUSTOMER MESSAGE</p><p>${escapeHtml(request.text)}</p><span class="muted">Ready to run. The agent will take at most six steps.</span></div>`; return }
  $('#timeline-content').innerHTML = run.steps.map((step, index) => `<article class="step-card"><div class="step-marker">${String(index + 1).padStart(2, '0')}</div><div class="step-body"><div class="step-meta"><span>Step ${index + 1}</span><span class="brain-label">${step.brain}</span></div><p class="thought">${escapeHtml(step.thought)}</p><div class="tool-call"><code>${step.tool}</code><pre>${escapeHtml(JSON.stringify(step.args, null, 2))}</pre></div>${step.result ? `<div class="tool-result"><span>Result</span><pre>${escapeHtml(JSON.stringify(step.result, null, 2))}</pre></div>` : ''}${step.error ? `<div class="error-box">${escapeHtml(step.error.join?.(', ') ?? step.error)}</div>` : ''}</div></article>`).join('') + `<div class="run-status ${run.status}"><span class="status-dot"></span>${run.status.replace('_', ' ')}</div>`
}
function renderApprovals() {
  const pending = state.approvals.filter(item => item.status === 'pending')
  $('#approvals-content').innerHTML = pending.length ? pending.map(item => `<article class="approval-card"><div class="approval-heading"><span class="approval-icon">!</span><div><strong>${item.tool.replace('_', ' ')}</strong><span>${item.requestId}</span></div></div><pre>${escapeHtml(JSON.stringify(item.args, null, 2))}</pre><div class="approval-actions"><button class="reject" data-reject="${item.id}">Reject</button><button class="approve" data-approve="${item.id}">Approve</button></div></article>`).join('') : '<div class="empty-state small"><span class="empty-icon">✓</span><h3>Queue is clear</h3><p>Side effects will appear here before they run.</p></div>'
  document.querySelectorAll('[data-approve]').forEach(button => button.addEventListener('click', () => decide(button.dataset.approve, 'approve')))
  document.querySelectorAll('[data-reject]').forEach(button => button.addEventListener('click', () => decide(button.dataset.reject, 'reject')))
}
function renderAudit() { $('#audit').innerHTML = state.audit.length ? [...state.audit].reverse().map(item => `<div class="audit-row"><span class="audit-time">${new Date(item.time).toLocaleTimeString()}</span><strong>${item.tool}</strong><span>${item.requestId}</span><small>${item.who}</small></div>`).join('') : '<div class="empty-state small"><span class="empty-icon">◷</span><h3>No decisions yet</h3><p>Actions will be recorded here.</p></div>' }
async function decide(id, action) { await fetch(`/api/approvals/${id}/${action}`, { method: 'POST' }); await refresh() }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]) }
$('#run-all').addEventListener('click', async () => { await fetch('/api/run-all', { method: 'POST' }); await refresh() })
$('#run-one').addEventListener('click', async () => { await fetch(`/api/requests/${selected}/run`, { method: 'POST' }); await refresh() })
document.querySelectorAll('[data-tab]').forEach(tab => tab.addEventListener('click', () => { activeTab = tab.dataset.tab; document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab)); $('#approvals-content').classList.toggle('hidden', activeTab !== 'approvals'); $('#audit').classList.toggle('hidden', activeTab !== 'audit') }))
refresh()
setInterval(refresh, 650)
