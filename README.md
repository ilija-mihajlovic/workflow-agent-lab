# Workflow Agent Lab

Workflow Agent Lab is a small, real, offline demonstration of a safe business workflow. It reads fictional support requests for an online shop, chooses constrained tools, shows every step, drafts responses, and waits for human approval before a reply is sent or a refund is issued.

The default brain is a deterministic rules engine. It is a stand in for an LLM, not an AI model. The optional Ollama brain is off by default and is used only when `OLLAMA_URL` and `OLLAMA_MODEL` are set. It was not benchmarked.

## Run it

You need Node 22 or newer. There are no packages to install and the default run makes no network calls.

```sh
node server.js
```

Open `http://127.0.0.1:8790` in a browser. Use `PORT=9000 node server.js` to choose another local port.

Run the tests with:

```sh
node --test
```

The optional Ollama mode uses a local endpoint such as this:

```sh
OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=gemma3:4b BRAIN=ollama node server.js
```

The client sends only to the configured local Ollama endpoint. Any network error, HTTP error, invalid JSON, or invalid decision returns to the rules engine.

## Architecture

`server.js` serves the static console and a small JSON API. It holds the demo state in memory and binds only to `127.0.0.1`.

`agent.js` runs one request through a bounded loop of at most six decisions. Each decision has a thought, a tool name, arguments, and a brain label. The loop records the decision, validates arguments, executes the tool, and stops at a queue item, escalation, completion, error, or the step limit.

`tools.js` contains JSON Schema shaped definitions and implementations over the sample request and order data. It also detects injection patterns, maintains the approval queue, validates arguments, and writes audit entries.

`brains.js` contains the rules engine and the optional Ollama adapter. Both return the same small decision shape.

`index.html`, `app.js`, and `style.css` make the three pane console. The browser polls the state API so the timeline changes while a run is in progress. The stable capture ids are `run-all`, `run-one`, `inbox`, `timeline`, `approvals`, `audit`, and `counters`.

## Fixed refund rules

The demo applies these rules.

1. An order is refundable within 30 days of delivery.
2. A damaged item is always eligible within the policy check.
3. Amounts over 150 KM need a person and are blocked from approval by the automatic path.
4. An order that is missing or outside the policy is escalated.

The 150 KM threshold is fictional demo data. A production workflow would make the policy configurable, versioned, and reviewed by the business owner.

## Tool table

| Tool | Purpose | Side effect |
| --- | --- | --- |
| `classify_request` | Categorizes text and urgency | No |
| `lookup_order` | Reads an order record | No |
| `check_refund_policy` | Applies the fixed policy | No |
| `draft_reply` | Creates a reply preview | No |
| `create_ticket` | Creates a low risk internal ticket | Executes immediately |
| `issue_refund` | Requests a refund | Approval required |
| `send_reply` | Requests an outbound reply | Approval required |
| `escalate_to_human` | Routes a request to a person | Executes immediately |

## Safety design

Customer text is data. The agent does not treat it as instructions. Patterns such as `ignore your rules`, `system prompt`, `developer message`, `jailbreak`, and requests to reveal instructions are flagged. A flagged request is classified as a prompt injection and escalated.

Every tool call is checked against its input schema. The loop never accepts an arbitrary tool name or malformed arguments. The loop also has a hard six step bound.

Refunds and replies are queue items. The tool call does not execute the side effect. A person must click Approve. Reject leaves the item unexecuted. The audit log records the time, request id, tool, a compact arguments summary, and who decided.

The refund limit is checked before the approval queue. A refund above 150 KM is blocked from approval and escalated.

## Evaluation cases

The 14 request fixtures cover order tracking, a recent refund, a damaged item, an address change, an invoice question, a prompt injection attempt, an angry message, spam, a general product question, an old refund, an over limit damaged order, a missing order number, a VAT receipt question, and a gift question.

The test suite has more than 34 cases covering each tool, schema failures, the bounded loop, injection handling, refund rules, approval behavior, rejection, audit entries, Ollama fallback, and an HTTP smoke test.

## Honest limits

The data is fictional and the state disappears when the process stops. The rules brain is not a language model. The Ollama path was not benchmarked. There is no identity verification, persistent database, authentication, payment provider, email provider, or production authorization model. Those are deliberate boundaries for a local workflow demonstration.

## License

MIT. Copyright Ilija Mihajlovic.
