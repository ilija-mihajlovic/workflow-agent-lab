import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import requests from './data/requests.json' with { type: 'json' }
import orders from './data/orders.json' with { type: 'json' }
import { runAgent } from './agent.js'
import { createToolBox, approve } from './tools.js'
import { createBrain } from './brains.js'

const root = path.dirname(fileURLToPath(import.meta.url))
export function createApp({ preferredBrain = process.env.BRAIN ?? 'rules', delay = 100 } = {}) {
  const state = { requests, orders, runs: new Map(), approvals: [], audit: [], escalated: new Set() }
  const tools = createToolBox({ requests, orders })
  const brain = createBrain({ preferred: preferredBrain })
  const json = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)) }
  async function run(request) { if (state.runs.get(request.id)?.status === 'running') return; await runAgent(request, { brain, tools, state, onStep: async () => { if (delay) await new Promise(resolve => setTimeout(resolve, delay)) } }) }
  const snapshot = () => ({ requests, runs: [...state.runs.values()], approvals: state.approvals, audit: state.audit, counters: { handled: [...state.runs.values()].filter(run => ['completed', 'escalated'].includes(run.status)).length, waiting: state.approvals.filter(item => item.status === 'pending').length, escalated: state.escalated.size } })
  const handler = async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(await readFile(path.join(root, 'index.html'))); return }
    if (request.method === 'GET' && ['app.js', 'style.css'].includes(url.pathname.slice(1))) { const name = url.pathname.slice(1); response.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); response.end(await readFile(path.join(root, name))); return }
    if (request.method === 'GET' && url.pathname === '/api/state') { json(response, 200, snapshot()); return }
    if (request.method === 'POST' && url.pathname === '/api/run-all') { requests.forEach(item => { void run(item) }); json(response, 202, { started: true }); return }
    const runMatch = url.pathname.match(/^\/api\/requests\/(REQ-[0-9]{3})\/run$/)
    if (request.method === 'POST' && runMatch) { const item = requests.find(entry => entry.id === runMatch[1]); if (!item) { json(response, 404, { error: 'Request not found' }); return } void run(item); json(response, 202, { started: true, requestId: item.id }); return }
    const approvalMatch = url.pathname.match(/^\/api\/approvals\/(APR-[0-9]{3})\/(approve|reject)$/)
    if (request.method === 'POST' && approvalMatch) { const result = approve(state, approvalMatch[1], approvalMatch[2] === 'approve' ? 'approved' : 'rejected'); json(response, result.ok ? 200 : 404, result); return }
    if (request.method === 'GET' && url.pathname === '/api/health') { json(response, 200, { ok: true, brain: preferredBrain }); return }
    json(response, 404, { error: 'Not found' })
  }
  return { handler, state, snapshot }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8790)
  const app = createApp()
  http.createServer(app.handler).listen(port, '127.0.0.1', () => console.log(`Workflow Agent Lab listening at http://127.0.0.1:${port}`))
}
