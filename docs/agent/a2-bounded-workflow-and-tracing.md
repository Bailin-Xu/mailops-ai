# A2 — Bounded Python/LangGraph workflow and execution tracing

Date: 2026-10-30. Status: implemented locally; A3 persistence/commit not implemented.

## Runtime and business boundary

`services/agent/api.py` provides authenticated POST /runs and GET /runs/{runId}.
It accepts one trusted run grant per local service process. Versioned agent-v1
commands must use START, expected run revision 0, graph agent-graph-v1, policy
agent-policy-v1 and prompt agent-prompt-v1. Unknown versions or duplicate starts
are rejected. Status/refresh performs no model invocation. Origin is rejected and
Host must be loopback; the launcher must bind uvicorn to 127.0.0.1. Credentials are
transport headers, never prompts/tool arguments. API metadata/proposals are visible
only to the configured service credential.

The LangGraph StateGraph executes context -> classify -> decide -> tool -> decide,
with conditional policy/end branches. The context read is deterministic; subsequent
Search/Inspect decisions are model-selected. Search may be reformulated based on
results. Inspect must reference a revision returned by search. Draft requires an
inspected revision, matching source language, and a fresh same-revision read before
returning the proposal. Escalate ends with a structured reason. Multiple tool calls
in one model response are rejected; the model cannot inject run IDs or credentials.

Low confidence (<0.70), review-required, unsupported primary language, mismatched
classification language and non-question categories conservatively request human
handling. A2 does not apply classification proposals to business queues; A3 must
map these outcomes through current TS admission/review policy. No business DB URL,
write tool, approval or sending operation exists in the Python runtime.

The model proposes subject/body plus a single revision reference. The runtime
constructs the agent-v1 Proposal itself using the command's context/fence and a
verified entry/revision/hash. Citation membership and version consistency are
validated; semantic entailment is not proven by these checks. Human review remains
mandatory for every draft. Text markers are trust boundaries, not an assertion that
every eventual live model resists prompt injection.

## Models and budgets

`models.py` defines a model protocol with deterministic MockModel and GeminiModel.
Gemini uses LangChain ChatGoogleGenerativeAI: schema-based classification and native
function/tool calls for Search, Inspect, Draft and Escalate. Its SDK retry setting
is zero so application budgets own retries. Tests replace the SDK boundary and
verify tool definitions, structured classification and usage forwarding; no real
Gemini call was made. Actual live quality is A4 evidence, not an A2 claim.

Execution caps: 6 model calls, 8 tool calls, 2 attempts per retryable operation,
20 seconds/model attempt, 5 seconds/MCP attempt, 120 seconds active execution.
The MCP server retains its tighter 2-second operation/1-second SQL bounds. Retries
consume the same total counters. Model timeouts and transient provider status codes
429/500/502/503/504 are retryable; malformed outputs and unauthorized decisions fail.
At most one action per response; graph recursion also capped at 40 supersteps.

Input protection uses UTF-8 bytes plus 4,096 reserved bytes for fixed instructions/
tool schemas as a conservative estimate against the 16,000-token ceiling. Decoded
model decision output is capped at 2,048 UTF-8 bytes, intentionally stricter than a
2,048-token ceiling; the provider also receives max_output_tokens=2048. Known usage
above either token limit fails with BUDGET. These checks are operational limits,
not a claim of perfect provider billing accounting. Unknown usage remains null.

Budget/deadline exhaustion returns a human escalation; invalid output/tool/source
or backend failure returns FAILED with sanitized code. Changed input/source returns
STALE. No failure erases a prior draft because A2 has no business-write capability.
All accepted proposals wait for human handling. No business commit occurs here.

## Trace behavior

Every run emits versioned run/node/model/tool metadata with run/trace/event IDs,
sequence, attempt, timing and nullable model usage where available. Local JSONL
files live under ignored data/agent-runs with creation permission 0600. API status
includes sanitized events for inspection. Bodies, raw prompts, tool text, reasoning,
credentials and exception messages are not included. Model decisions and draft
text appear only in the authorized result, not the trace export.

Automatic LangSmith/LangChain payload tracing is disabled around graph/model calls.
An explicitly configured LangSmithExporter exports metadata-only events to the fixed
LangSmith endpoint, with a bounded request timeout and omitted runtime information.
Exporter failures are recorded locally as EXPORT_FAILED and leave the proposal
unchanged. The adapter is implemented and failure-tested with a fake exporter;
no external LangSmith request was made. External SDK/network behavior is not claimed
as validated live. Local trace persistence errors fail execution rather than pretending
an audit exists. Event files alone do not provide A3 recovery or exactly-once execution.

## Startup and checks

From repository root, create services/agent/.venv using Python 3.12 and install
requirements.lock. Direct tools/runtime versions are in requirements.in; the lock
includes transitive versions. Python checks use Ruff, mypy and pytest. Existing A0/A1
Python modules were formatted and annotated to join these checks, without changing
their contract semantics.

Start the synthetic MCP listener per the A1 runbook, with the same trusted run ID
and capability. Configure AGENT_SERVICE_TOKEN (random secret >=32 characters),
MCP_RUN_ID, MCP_CAPABILITY and AGENT_MCP_URL (explicit loopback /mcp endpoint), then:

```bash
services/agent/.venv/bin/uvicorn api:from_environment --factory --app-dir services/agent --host 127.0.0.1 --port 8102
```

Default model is mock regardless of the web application's AI_PROVIDER. Explicit
AGENT_MODEL_PROVIDER=gemini additionally requires AGENT_LIVE_ENABLED=true,
AGENT_SYNTHETIC_HASH matching the committed synthetic corpus, GEMINI_MODEL,
GEMINI_API_KEY, positive finite AGENT_MAX_SPEND, AGENT_INPUT_PRICE_PER_MILLION,
AGENT_OUTPUT_PRICE_PER_MILLION and nonempty AGENT_PRICING_SOURCE,
AGENT_PRICING_DATE, AGENT_CURRENCY. Startup reserves the estimated worst-case six
bounded calls; insufficient reservation rejects startup. These are caller-supplied
pricing estimates, not verified billing guarantees. A4 adds reviewed run manifests,
paired experiment controls and full spending evidence. No live settings were used here.
AGENT_TRACE_EXPORT_ENABLED=true separately requires LANGSMITH_API_KEY; default is off.

POST a validated Command with Authorization: Bearer AGENT_SERVICE_TOKEN. Its context
hash must match get_thread_context from the authorized MCP fixture. GET the run ID
for the proposal, counters and sanitized events. Use synthetic data only.

```bash
npm run agent:check
npm run check
npm run test:integration
# With explicit isolated fixture DB configured and seeded:
npm run agent:mcp:test
npm run agent:workflow:test
```

agent:workflow:test starts the real MCP listener on an ephemeral loopback port and
runs Python FastAPI's ASGI test client through the complete LangGraph/mock workflow.
It verifies a French source-backed proposal, counters, status and duplicate-start
rejection. The API is exercised in-process; a separate uvicorn socket startup was
not acceptance-tested. Python/mock checks were added to GitHub Actions; remote CI
execution is not claimed. Browser tests were not rerun because no UI changed.

## Stage acceptance and limits

- A2-T1/T2 and A2-A1: actual LangGraph loop, real MCP client, mock/Gemini adapter
  boundary and FastAPI run/status. Tests assert direct, revised-search, no-answer,
  conflict, invalid action/output/source and budget paths and actual tool queries.
- A2-T3/A2-A2: model/tool/retry/deadline/input/output caps, language and source
  checks; failure preserves command/draft reference. No database writes in Python.
- A2-T4/A2-A3: local sanitized events, optional exporter, version metadata and
  exporter failure isolation. No live tracing or quality result claimed.
- A2-T5/A2-A4: French preserved, neutral replies, explicit human fallback,
  pinned Python checks and setup; final counts in docs/17 closure.

A2 state lives in memory; one run per process is an intentional local foundation.
WAITING_FOR_HUMAN is a handoff result, not a durable interrupt. RESUME/CANCEL are
rejected, not advertised as working. A3 adds durable checkpoints, admission/fencing,
leases, cancellation and safe TS business commits. Baseline Inbox remains separate;
the synthetic MCP snapshot is not a connection to existing private development mail.
No real mailbox, cloud, multi-agent, embeddings or production worker was added.
