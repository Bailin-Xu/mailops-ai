# A3 — Persistent execution, human continuation and safe business commit

Date: 2026-10-30. Scope: local, opt-in Agent execution. No live model, real sending,
cloud worker, product authentication or browser Agent controls are added.

## Ownership and storage

- TypeScript/PostgreSQL owns AgentAdmission, classification, human edits, knowledge,
  drafts and AgentCommitReceipt. New tables are added by
  `20261030160000_add_agent_admission`; no historical migration was edited.
- Python owns LangGraph Postgres checkpoints plus versioned `agent_runtime_a3`
  control metadata in a separate PostgreSQL instance/database/role on loopback 5436.
  It receives no business DB credentials. Checkpoint initialization is an explicit
  command, not web-startup DDL. The library maintains its checkpoint migration table;
  the A3 control schema is initialized separately and idempotently.
- Checkpoint Docker storage uses a named volume so stopping/restarting a service
  does not remove paused work. Do not delete the volume to troubleshoot a failed run.
  Tests delete only their owned run IDs, never whole shared checkpoint tables.
- `persistGroundedDraft` is extracted from the existing processing service. The
  baseline and Agent use the same transaction-local evidence, context, prior-edit,
  supersession and pending-draft persistence rules.

The application MCP adapter is opt-in (`MCP_SOURCE=application` plus
AGENT_RUNTIME_ENABLED=true and an explicit DATABASE_URL). It reads the admitted
classification's canonical inbound context, approved search results and current
immutable knowledge revisions. It reuses production search/context functions.
It does not create knowledge revisions, approve, or send. Existing snapshot mode
remains the default. Business source selection is independent of checkpoint storage.

## Business admission and protocol

The new POST /api/agent/commands endpoint is disabled unless AGENT_RUNTIME_ENABLED
is true and AGENT_BRIDGE_TOKEN has at least 32 characters. Browser Origins and
invalid credentials are rejected before database access. All commands are validated;
responses use sanitized error codes. Bridge credentials are held by the Python
service, never by the model or MCP tool arguments.

| Operation | Purpose |
| --- | --- |
| ADMIT | Bind a run UUID to an existing classification and immutable context/review preconditions |
| STATUS | Read authoritative run revision, execution fence and any business receipt |
| CLAIM | Acquire/reclaim an execution lease using expected revision and unique command/owner IDs |
| CONTROL | Heartbeat, pause, fail or mark stale under the live execution fence |
| CANCEL | Invalidate a running or paused admission using expected revision |
| COMMIT | Atomically validate/persist a proposal and immutable command receipt |

ADMIT uses an existing TS classification, not a new AI approval path. The Python
classification proposal is validated against current category/language and the
shared confidence threshold. A pending classification cannot produce a draft.
Human corrections are retained; Agent classification suggestions never overwrite
reviewed fields. Escalation preserves review status and routes to human handling.
Draft-generation AIExecution metadata records the Agent classification proposal.

Admission binds canonical thread ID, full inbound context hash, classification
revision and the exact current GENERATED draft ID/review revision, including an
explicit no-draft precondition. New inbound mail, reclassification, reconstruction,
human editing/rejection or terminal sending make the old preconditions ineligible.
Knowledge identity/version/content are revalidated separately at resume and commit.

## Lease, checkpoint and budget protection

Claims use serializable TS transactions and compare-and-set revisions. Leases last
30 seconds; the executor renews every 10 seconds. Reclaim changes owner and increments
an execution fence. An active executor cannot be displaced by a competing claim.
Exact claim replay by the same owner/command returns its current lease; altered
claim payload or a duplicate competing resume is rejected.

Python also acquires an isolated control-row lease before execution. Checkpoint writes
and task writes hold that row's lock while checking owner/status/expiry; a cancelled
or replaced process cannot append late checkpoints. This uses the actual PostgreSQL
checkpointer, not an in-memory stand-in. Final business submission independently
checks the current TS fence/owner/expiry in its transaction. Heartbeat failure stops
execution; provider requests already accepted externally cannot be undone.

Model/tool attempts are reserved durably BEFORE invocation. The 6-model/8-tool limits
survive crashes and all resumes; retrying an interrupted request may consume another
attempt, not restore the lost budget. Runtime elapsed active time persists too.
An abruptly killed process's offline interval is conservatively charged until its
lease is reclaimed; a long outage may exhaust the 120-second budget. Human waiting
is excluded after a successful pause. Up to three human continuations are allowed.
Exhausted budgets require manual handling/a fresh explicit run, not an automatic reset.

Immutable command context, graph/policy/prompt/model identifiers, code and dependency
fingerprints are checked before recovering a run. Credentials may rotate without
changing business context. Software upgrades that change the fingerprint require
fresh execution or an explicitly designed future migration, not silent resume.
This remains a local lease design, not a claim of cross-region high availability.

## Persisted pause and continuation

The graph checkpoints the proposal and calls LangGraph interrupt at the human
handoff. Initial execution returns WAITING_FOR_HUMAN. A new authorized RESUME
command with the current business revision reclaims execution and revalidates:

1. canonical inbound context and classification/draft review preconditions;
2. saved search results against active approved knowledge, reestablishing MCP
   reference permissions after the MCP listener is recreated;
3. the exact inspected source revision and content hash.

Changed/retired/missing evidence becomes STALE; the old proposal cannot be accepted.
A fresh run is required after human edits/corrections or material knowledge changes.
A successful continuation finishes the graph and submits a pending GENERATED draft.
This continuation never confirms a classification, approves a draft or sends mail.
Final editing and confirm-and-simulate-send remain the existing human review workflow.

START/RESUME/CANCEL use the existing agent-v1 Command contract. Command IDs must be
fresh per control attempt, expectedRunRevision comes from authoritative STATUS,
and TS assigns the actual execution fence. Recovery after a process death uses
RESUME once its old leases expire. Incomplete graph tasks continue from checkpoints;
finished nodes need not repeat model calls, though interrupted calls remain at-least-once.

## Atomic commit and recovery

A serializable business transaction checks lease/fence/cancellation, all review
preconditions and source eligibility. It reuses full-text search for the saved
selected-source query, records the actual score, then persists the draft/evidence,
updates classification state and inserts a receipt together. A receipt failure
rolls back ALL draft/classification changes. Prior drafts are superseded only by a
successful replacement. Confirmed history is never rewritten.

The receipt key is (runId, original proposal commandId). Its SHA-256 binds the
validated semantic payload, including context, selected source, classification,
model, prompt and query. Lease owner/fence are excluded from that hash because a
recovery legitimately renews them; the live fence is still checked for every new
mutation. Matching replay returns the stored result; changed payload is rejected.
A second no-draft run or legacy generation race cannot publish against an already
advanced classification revision.

The prepared submission is persisted in the checkpoint control DB before HTTP commit.
A pre-submit network failure can retry the same proposal under a new valid lease,
without repeating model or MCP calls. If commit succeeded but acknowledgement was
lost, the business receipt is authoritative. STATUS/RESUME can report a committed
receipt even after that run's graph AND Python control records are lost; no model
or business mutation is repeated. Uncommitted checkpoint loss is explicit failure,
not permission to regenerate a proposal from empty state automatically.

The two databases are not one distributed transaction. Recovery relies on the
business receipt, live fencing and checkpoint/control reconciliation. Model/API
calls are not exactly-once. A network failure with unknown commit outcome is
COMMIT_UNKNOWN until reconciled. Definitive stale evidence is terminal STALE.
The AIExecution latency field is scoped as BUSINESS_VALIDATION_ONLY for this path;
model latency/nullable usage remains in execution events, not invented from commit
latency. Tokens/cost are not fabricated when unavailable.

## Local setup and operation

Use a separate synthetic business database for trying Agent integration. The current
development Inbox has NOT been established as entirely synthetic. This task did not
migrate it, process its messages or enable Agent mode on the running web app.

1. Apply Prisma migrations to the explicitly selected synthetic business target.
2. Start the dedicated checkpoint service and explicitly initialize its schemas:

```bash
docker compose --profile agent-checkpoint up -d postgres-agent-checkpoint
export AGENT_CHECKPOINT_DATABASE_URL=postgresql://mailops_agent_checkpoint:mailops_agent_checkpoint_local@127.0.0.1:5436/mailops_agent_checkpoint
npm run agent:checkpoint:setup
```

3. Start Next.js against that synthetic business DB with AGENT_RUNTIME_ENABLED=true
   and a random AGENT_BRIDGE_TOKEN. Keep the token outside Git. ADMIT a run using a
   synthetic classification ID through the authenticated bridge; retain its context.
4. Start MCP application mode against the same synthetic business DB/run ID and a
   fresh MCP_CAPABILITY. Python receives AGENT_MCP_URL/capability, not DATABASE_URL.
   The local MCP grant lasts five minutes; recreate a grant/listener after longer
   human waiting. Resume reestablishes reference scope and verifies unchanged facts.
5. Configure Python's AGENT_SERVICE_TOKEN, MCP_RUN_ID, AGENT_BRIDGE_URL (loopback
   /api/agent/commands), AGENT_BRIDGE_TOKEN and AGENT_CHECKPOINT_DATABASE_URL, then
   use the A2 uvicorn command. Production factory now requires durable configuration;
   there is no silent in-memory fallback. The explicitly injected A2 in-memory app
   remains only for unit/backward-compatibility tests.
6. START with the admitted context and version IDs; inspect Python GET /runs/{id}.
   It reports authoritative business revision/fence for RESUME/CANCEL. Resume after
   reviewing a proposal; then use existing draft review and simulated-send UI.

If business receipts say COMMITTED, use the returned draft ID rather than generating
again. Cancellation cannot retract an already committed draft; use normal human
review/rejection. If checkpoint storage is unavailable, restore connectivity before
uncommitted recovery. If uncommitted checkpoints are genuinely lost, restore a
consistent backup or start fresh explicitly after invalidating/cancelling old work.
The baseline workflow remains usable with Agent mode disabled. Backup/restore
automation and deployment are not implemented or claimed here.

## Verification and limitations

```bash
npm run check
npm run agent:check
# Explicit isolated test DB, checkpoint service already initialized:
npm run test:integration
npm run agent:durable:test
npm run agent:upgrade:test
```

The durable harness creates owned synthetic application records, hosts the TS
business functions behind authenticated local HTTP and starts the actual MCP
listener. It launches separate Python/FastAPI ASGI processes, uses SIGKILL at real
execution points and verifies one draft/receipt and cumulative budgets. Expiry is
advanced only in owned test rows to avoid waiting 30 seconds. The HTTP business
harness exercises the same services as the Next route; full uvicorn/Next socket
orchestration is not claimed as browser acceptance. New route boundary tests check
that disabled/unauthorized requests never access the database.

The nine scenarios cover normal persisted human pause, kill before tool result,
kill after a checkpoint, lost commit acknowledgement (including lost checkpoint
records after commit), lost uncommitted checkpoints, active cancellation/late work,
checkpoint connection failure, failed-submit retry without model/tool repeats, and
knowledge revision plus MCP listener recreation during human pause. Competing
processes are rejected while an executor is active. Tests use mock providers only.

Database integration tests cover stale inbound/review/knowledge/classification/
reconstruction, changed-payload replay, expired fences, duplicate claims/resumes,
parallel no-draft runs, legacy generation races, receipt-write rollback, low
confidence and confirmed-history preservation. A scratch migration check upgrades
old-schema French/message/classification data and verifies byte-equivalent records.
No schema drift was detected against the migrated test DB.

A dedicated CI job is configured for MCP/durable tests with isolated PostgreSQL
services. Remote CI execution has not been performed. No UI controls changed, so
browser tests were not rerun. The local checkpoint volume remains for persistence;
only test-owned rows are cleaned. Live Gemini/LangSmith, production delivery and
model-quality improvements remain unverified and outside A3 completion evidence.
