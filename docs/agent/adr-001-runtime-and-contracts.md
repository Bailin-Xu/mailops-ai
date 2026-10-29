# ADR A0-001 — Bounded Python Agent and TypeScript business authority

Date: 2026-10-29. Status: accepted design; A1–A5 runtime not implemented.

## Ownership and topology

Next.js remains the human-facing product and TypeScript remains the only business
writer. A Python FastAPI/LangGraph service orchestrates model/tool decisions. The
TypeScript MCP service wraps current context/search/revision services, not a copy
of them. The Agent returns a proposal to a deterministic TS commit command; no
write/approve/send command appears in the MCP tool list. Existing baseline remains
the default. No automatic fallback may double-run models on failure.

Reserve configurable loopback ports 8102 (Python) and 8103 (MCP), checking occupancy
before startup. Browser requests go through Next.js. Use MCP Streamable HTTP with
explicit host/origin checks and service credentials, disabled CORS by default.
Credentials travel in transport headers and are never graph/model arguments.
A0 defines payloads only; A1 adds real protocol responses and interoperability tests.

MCP calls require a server-issued opaque capability bound to run, canonical thread,
allowed tools, expiry and evidence scope. The server verifies it independently of
model IDs. Lookup references must belong to this run's context/search results.
Read-only search returns only active approved knowledge and immutable revision IDs;
body sizes are capped at the boundary. No arbitrary SQL, URL, file or attachment tool.

Business schema remains Prisma-owned. A3 adds only admission/receipt metadata and
indexes needed by demonstrated operations. Python receives no business DB URL.
Checkpoints use a separate DB/role, LangGraph runId as thread_id, and an explicitly
invoked, versioned checkpoint setup procedure; never auto-DDL on web startup.
Checkpoint retention/deletion applies to completed synthetic runs independently of
business audit retention. Proposed retention: 7 days locally, explicit cleanup only.

## State and command protocol

`contracts/agent/schema.ts` and `services/agent/contracts.py` validate JSON at each
boundary. `contracts/agent/fixtures.json` is the shared compatibility corpus.
Schemas are maintained together; A0 checks both against identical valid/invalid
cases. A1 must extend fixtures for concrete MCP result schemas before adding tools.

- START requires expectedRunRevision=0 and no existing command with a different
  payload. TS captures canonical thread, context hash, classification revision and
  current draft/review identity; null draft is an explicit precondition.
- RESUME accepts only WAITING_FOR_HUMAN or a retryable FAILED state, matching run
  revision and unchanged business preconditions. A human review occurs through TS
  first; if it changes those preconditions, start a refreshed run, do not re-use old
  evidence. Budget counters are cumulative across resume, with at most 3 resumes.
- CANCEL is terminal and idempotent. Invalidate the admission fence transactionally;
  an in-flight provider call may still charge, but its proposal cannot commit.
- RUNNING may become WAITING_FOR_HUMAN, SUCCEEDED, FAILED, CANCELLED or STALE.
  WAITING/ retryable FAILED may become RUNNING after validation. SUCCEEDED,
  CANCELLED, STALE and nonretryable FAILED cannot reopen.
- SUCCEEDED means a proposal was safely accepted or a human escalation recorded;
  it never means knowledge/draft/send approval. WAITING maps to existing review
  queues. STALE creates no business write except the run-admission outcome.

TS admission row owns run revision, fence, cancellation and lease expiry. Claim or
renew under a conditional update; initially a 30-second lease renewed every 10
seconds. Reclaim increments fence. All business commits check fence, cancellation,
lease validity, context, classification, evidence eligibility and draft identity in
the same serializable transaction as the mutation and receipt. Two no-draft runs
must race on the business revision, not only a missing draft row.

Receipt key is (runId, commandId); store canonical validated payload SHA-256 and the
result. Exact replay returns the original receipt; changed payload is CONFLICT.
A receipt after checkpoint loss is reconciled before executing another mutation.
Provider/tool work is at-least-once; never claim exactly-once model usage.

Errors: INVALID_INPUT (nonretryable), UNAUTHORIZED (nonretryable), CONFLICT/STALE
(refresh required), TIMEOUT/PROVIDER_ERROR (bounded retry), BUDGET (human handling).
Transport errors must not expose stack traces or credentials. Retrying counts toward
6 model calls, 8 tool invocations, 2 attempts per operation and 120 active seconds.
Total configured model output cap: 2,048 tokens/call; maximum input 16,000 tokens/call.
If accurate counting is unavailable, use a conservative estimator and reject oversized
inputs. These are proposed execution limits to enforce and test in A2, not A0 runtime.

Trace IDs correlate run/event/tool/model/receipt identities. Record versions, elapsed
time, status and nullable usage, not hidden reasoning. Export off by default. LangSmith
is an optional A2/A4 exporter, configured explicitly for synthetic data only. Local
records remain available when export fails. Capabilities, bodies, prompts, secrets,
canary strings and raw tool output are excluded from default telemetry.

## Dependency decision and verification

Contract environment: Python 3.12.14; exact transitive installation in
`services/agent/requirements.lock`, direct pins in requirements.in. Observed public
registry versions on 2026-10-29: Pydantic 2.14.2, FastAPI 0.162.0, LangGraph 1.2.18,
checkpoint-postgres 3.2.0, langchain-google-genai 4.4.2, MCP Python 2.3.0.
Resolution/install and pip check passed on Python 3.12.14. No runtime Agent or SDK
interoperability is claimed from successful dependency resolution. Proposed A1 TS
MCP SDK pin is 1.32.2 (registry verified); Python/TS protocol compatibility is an A1
acceptance test, including negotiated protocol version. SDK major numbers need not
match. A0 installs the Python environment only for compatibility/contract checks.

Reproduce: create services/agent/.venv with Python 3.12, run its pip with
`install -r services/agent/requirements.lock`, then `npm run agent:contracts:python`.
Use `npm run check` for TypeScript validation. A2 adds Ruff/mypy/pytest and their
pinned development dependencies; those tools are not represented as running today.

Official references inspected: [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence),
[MCP server SDK guidance](https://modelcontextprotocol.io/docs/develop/build-server).
Use current SDK documentation during A1; do not infer API compatibility from names.
