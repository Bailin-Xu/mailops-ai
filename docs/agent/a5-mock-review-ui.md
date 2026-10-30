# A5 — Isolated mock Agent review UI

Status: mock product integration implemented (2026-10-30). A4 live paired
model evaluation, calibrated human scoring and external trace delivery remain
pending. The narrated 3–5 minute portfolio video is not recorded.

## What is connected

`app/inbox/agent-panel.tsx` is an opt-in English review panel. It displays READY,
RUNNING, WAITING_FOR_HUMAN, FAILED, STALE, CANCELLED and COMMITTED business states,
read-only Search/Inspect summaries, an unapproved proposal, and the immutable
knowledge answer/version used as evidence. English and original French content
are preserved. A proposal is not an approved or sent email.

The browser calls `/api/agent/ui`; commands require the same loopback Origin and
Host. Reads and page refreshes never execute Python or a model. Commands scope
run IDs to the selected thread and check the expected business revision. The
feature is disabled unless all mock/shadow/disabled-delivery flags are set, a
bridge capability is configured, and the business connection is exactly the
isolated `mailops_test` role/database on `127.0.0.1:5434` (no URL parameters).
The normal development database is deliberately unsupported by this slice.

An explicit start admits a snapshot and invokes a **foreground** Python process.
The Next.js adapter hosts an ephemeral authenticated loopback MCP endpoint using
A1's real application repository. Python executes A3's durable LangGraph runtime,
real MCP SDK calls and checkpoint/fence/receipt protocol. Each command uses fresh
MCP transport; PostgreSQL checkpoints survive process exits. This is a local
adapter, not a production worker queue or serverless deployment architecture.
No additional Python service or manual MCP process must be kept running.

`InteractiveMockModel` is fixed to `mock-ui-v1`: it uses the subject for the first
FTS search, inspects a revision, copies its approved answer or escalates. It never
calls a model API. A4's `MockModel` and frozen evaluation outputs are unchanged.
The child inherits only local runtime configuration, not provider or trace keys.

## Review and recovery

1. **Start mock Agent** explicitly classifies if necessary and admits the current
   classification, inbound context and existing draft revision. It does not
   approve a classification. The graph pauses before any business submission.
2. **Continue & create review handoff** checks current knowledge/context/draft
   again through the existing A3 commit transaction. It creates a GENERATED draft
   or a manual-review/human-answer route. The existing forms retain responsibility
   for editing and final simulated-send confirmation.
3. If knowledge is revised/retired, inbound text changes, or another human edits
   the old draft while paused, continuation is blocked. Historical evidence stays
   visible. **Start refreshed run** cancels the old run and admits current inputs.
4. **Cancel run** first invalidates business authority, then attempts checkpoint
   cancellation. Even if Python cleanup is unavailable, a late result cannot
   commit. Cancellation persists across refresh. It does not undo an already
   committed handoff.
5. A failed request preserves existing drafts. READY can be run explicitly;
   retryable FAILED or expired RUNNING can recover using A3's bounded policy.
   A WAITING run whose web preview was not saved offers **Recover saved preview**:
   this reads the checkpoint result without running the graph/model. A successful
   receipt can reconstruct draft evidence if a response was lost; unavailable
   call counts are null, not fabricated zeros.
6. After a handoff, the existing knowledge-staleness and human review controls
   govern the draft. Agent mode cannot approve, send real email or bypass review.

Cancellation does not forcibly kill a Python process; fences reject late writes
and the bounded process exits or times out. If the checkpoint database is lost,
A3's explicit failure/restart rules still apply; the UI does not silently replay
unrecoverable work. Do not delete a checkpoint volume to fix an ordinary error.

## Clean local mock setup

Requires the normal Node dependencies, Docker, Python 3.12 and the pinned Python
requirements. Use only the disposable synthetic test database. Do not run this
manual demo concurrently with destructive test/database commands.

```bash
npm ci
python3.12 -m venv services/agent/.venv
services/agent/.venv/bin/pip install -r services/agent/requirements.lock
docker compose --profile test --profile agent-checkpoint up -d postgres-test postgres-agent-checkpoint
export TEST_DATABASE_URL='postgresql://mailops_test:mailops_test_local@127.0.0.1:5434/mailops_test'
export AGENT_CHECKPOINT_DATABASE_URL='postgresql://mailops_agent_checkpoint:mailops_agent_checkpoint_local@127.0.0.1:5436/mailops_agent_checkpoint'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:deploy
npm run agent:checkpoint:setup
DATABASE_URL="$TEST_DATABASE_URL" AI_PROVIDER=mock npm run demo:seed
npm run agent:ui:mock
```

Open http://127.0.0.1:3115/inbox (use the numeric loopback host). The launcher forces
mock/shadow/no-delivery mode, generates an ephemeral bridge token and uses a
separate `.next-agent-ui` cache so an existing normal development app can remain
open. It does not apply migrations or seed data implicitly. Stop it with Ctrl-C;
checkpoint storage is retained. All setup and UI execution can run with no live
API key, mailbox, cloud account or trace export.

## Reproducible checks and evidence

```bash
npm run check
npm run agent:check
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm run test:integration
npm run agent:upgrade:test -- --preview
MAILOPS_E2E_AGENT=true npm run test:e2e
```

The browser command requires both exported database URLs above. Tests use owned,
neutral synthetic EN/FR fixtures; cleanup removes only those fixtures' business
rows and checkpoint UUIDs. It never truncates shared checkpoints. The standard
browser suite leaves Agent mode off unless explicitly enabled. CI's isolated
`agent-durable` job enables the Agent browser scenarios; its ordinary `check` job
continues covering the original interface without Python.

Coverage includes French pause/evidence/refresh/continue/simulated send, changed
knowledge and refreshed evidence, no-evidence handoff, cancellation and delayed
execution fencing, thread scoping, failure/retry with old-draft preservation, and
all existing review workflows. Unit/integration tests also cover opt-in/origin
boundaries, preview CAS/fences, immutable evidence and inbound staleness.
The preview migration is additive; a scratch prior-schema upgrade verifies old
admissions get null preview without changing stored messages/classifications.
Local browser evidence is generated at `test-results/a5-agent-french-handoff.png`
and ignored by Git; rerun the test to reproduce it. Check totals are recorded in
the A5 progress section of `docs/17-agent-development-implementation-plan.md`.

## Portfolio closure still pending

A5-T1/T2 and the local setup/limitations portion of T4 are implemented. A5-A1/A2
are supported by the checks recorded in docs/17. A5-T3 (narrated video) and final
role-specific resume editing remain pending, so A5 is not marked fully closed.

A future 3–5 minute synthetic recording should show EN and FR runs, Search/Inspect,
unapproved evidence, refresh without execution, a knowledge change and blocked
continuation, a refreshed run, explicit handoff then simulated-send confirmation,
cancellation, a stopped service and recovery. A screenshot or passing test is not
a claim that this narrated video exists.

Supported resume direction: **a bounded Python/LangGraph Agent using read-only MCP
knowledge tools, PostgreSQL checkpoints, explicit human pause/resume, fenced safe
submission and a Next.js review UI, exercised with deterministic synthetic mocks**.
Full-stack emphasis: immutable evidence and review conflicts; backend emphasis:
leases, fencing, idempotent receipts and recovery. Do not describe this as live
model validation, a measured quality improvement, multi-agent orchestration,
pgvector/Gmail integration, autonomous sending or production deployment. A4's real
paired runs, user scoring and tracing evidence remain separate unfinished work.
