# Phase 5 — Backend Thread Reconstruction and Scale

Verification date: **2026-10-28**. Scope: local reconstruction, relational integrity,
neutral synthetic benchmarks and regression checks. No real-mailbox connector,
external sending, production worker, vector search, deployment or Git commit.

## Reconstruction contract (FR-040–FR-043)

RFC `Message-ID`, `In-Reply-To` and `References` establish connected components.
Subject similarity never establishes a relationship. Cycles and self references
terminate safely; missing parents set `isIncomplete` until they arrive.

Existing persisted thread membership is preserved as an additional relationship.
A reconstruction does **not** split an established conversation whose historical
classifications/drafts/tickets cannot be attributed to individual subcomponents
without human judgment. Wrong historical grouping requires a separate reviewed
split operation; changing headers does not silently split old records.

The retained identity belongs to the earliest dated message, with stable Internet
message ID/fingerprint tie-breaking before import-created timestamps. Undated
messages therefore do not choose a root based only on import order. A newly
arrived older parent can become canonical; earlier thread UUIDs remain valid aliases.
Different import orders yield the same logical member groups, not identical random
UUIDs from separate imports. No message body or original RFC content is rewritten.
This operates on stored messages. Existing ingestion fingerprint duplicate policy
is unchanged: otherwise identical content/metadata with different RFC IDs may be
considered duplicate imports. Reconstruction cannot restore a message never stored;
refining that deduplication boundary is a separately identified follow-up.

### Identity, origins and associated records

- Only `EmailMessage.threadId` changes to canonical membership. `originalThreadId`
  preserves the first recorded ownership. Import captures it immediately; migration
  records current ownership as a legacy baseline, not proof of an unknown earlier
  assignment. Direct legacy/test rows capture it on their first move. Subsequent
  merges keep it unchanged.
- No old thread is deleted. `mergedIntoThreadId` and `mergedAt` preserve old entry
  points. Existing aliases are flattened to the active canonical root, including
  after a still-older parent arrives. Empty unrelated threads are not removed.
- Original classification, draft, dispatch and ticket thread FKs remain unchanged.
  They retain original attribution rather than pretending old outputs used today's
  combined conversation. Original AI execution inputs, knowledge revision links,
  saved/final human text and immutable evidence stay in place.
- Knowledge candidate source rows keep their message FK, excerpts and decisions;
  message identity/origin provides both original and current conversation ownership.
- Conflicting nonempty artist/account identities across source threads (including
  older aliases) block the merge. No identity is guessed or copied between cases.
- Reconstruction checks draft/classification, dispatch/draft and ticket/classification
  thread attribution before changing the graph. Corrupt existing relationships are
  rejected, not silently repaired.

Inbox excludes aliases from its queue and resolves an old selected-thread URL to
the canonical conversation, with a visible explanation. Search also matches member
message subjects. Old classifications whose workflow revision is no longer current
are not displayed as current work. Bounded lineage inspection exposes historical
record UUIDs/states and per-message original/current ownership; it does not publish
private message or draft bodies.

## Plan, apply and stale-state handling

```bash
npm run eml:threads:reconstruct
# Inspect the saved plan/summary, then explicitly choose to apply it:
npm run eml:threads:reconstruct -- --apply data/thread-plans/PLAN_UUID.json
npm run eml:threads:reconstruct -- --inspect THREAD_UUID
npm run eml:threads:reconstruct -- --inspect THREAD_UUID --page 2
```

The default command is a plan, not an application. It stores a versioned manifest
and checksum, expected component membership, and a snapshot signature in ignored
`data/thread-plans/` files with mode 0600. No body or private header text is included
in the saved plan. The earlier `eml:threads:plan` command remains a summary-only
planner; its result is not an apply manifest. The legacy diagnostic
`threadsToRemove` field is now `threadsToArchive`: application never deletes them.

Snapshot signatures bind message metadata/content stamps, thread state, classification
and draft versions, dispatches, tickets, source/grounding joins and AI executions.
Row stamps are generated within PostgreSQL; full bodies are not transferred into
the planning result. These are consistency checks, not user authentication or a
signature against a privileged database administrator.

Application validates the manifest with Zod and recomputes the planner result from
fresh data. A locally edited mapping cannot be applied by merely recalculating its
checksum. New messages, changed headers/bodies, reviews or relevant associated
records make the saved snapshot stale. Regenerate/review a new plan; application
never silently recomputes and applies a different plan.

Application acquires graph table write locks before revalidation, then validates,
moves messages, flattens aliases, invalidates work and records a receipt in **one
serializable transaction**. Set-based updates use at most 1,000 mapping tuples per
statement, avoiding per-message update round trips. Transaction timeout is 120 s;
lock/pool waiting is bounded. A real trigger-induced failure test verifies no
partially moved messages, aliases or workflow flags survive a failed transaction.

This is an explicit maintenance operation: all writers to the locked graph tables
wait, including unrelated threads, and competing work may need retry. It is not a page-render side effect or background
worker. Planning is also a serializable snapshot, without holding the apply locks.
The defensive 100,000-message planning ceiling is a guard, not a measured 100k
capacity claim. Body sizes and history density beyond the recorded corpus remain
unmeasured.

A receipt binds plan ID/checksum to the post-application snapshot. Replaying it
unchanged returns `ALREADY_APPLIED` with no logical writes or new audit timestamps.
A fresh plan of an already-correct graph returns `NO_CHANGE`. If the graph changed
after an application, replaying its old receipt fails stale instead of restoring an
old state. Inspection/ordinary reads do not invalidate receipts.

CLI failures return nonzero with bounded reason codes, without connection strings,
private bodies or stack traces. Normal CLI plan/apply uses the explicitly configured
application database; the benchmark/test commands below require the isolated target.
This task **did not apply reconstruction to development/private mailbox data**.

## Pending work and historical safety

Only newly joined inbound messages change the canonical classifier input boundary.
When that boundary changes, canonical workflow revision advances; donor workflow
revisions always advance and their classification services reject archived origins.
Pending drafts in affected origins are marked `THREAD_RECONSTRUCTED`, retaining
original outputs and saved edits but becoming ineligible for confirmation. The
next current classification runs on the canonical conversation.

Joining only outbound context leaves still-valid canonical inbound evidence usable.
This matches the current provider input/context contract; reconstruction does not
pretend that model context includes attachments or all outbound history.

Scheduled/retryable dispatches in invalidated origins are cancelled with a reason;
already-sent dispatches and confirmed drafts are preserved exactly. An affected
`SENDING` record blocks the entire apply: do not infer delivery outcome or erase a
lease. Operators must quiesce/resolve that workflow before preparing a new plan.
Scheduling/ticket creation rechecks reconstruction state transactionally, so stale
reads cannot create new work on an archived origin. Existing ticket history stays
reachable; reconstruction does not merge or resolve human-owned cases automatically.

## Schema and setup

Two additive migrations preserve applied migration history:

- `20261028170000_add_thread_lineage`: thread aliases, reconstruction metadata,
  self-reference guard and alias lookup index.
- `20261028173000_add_message_thread_origin`: original ownership FK/backfill/index.

```bash
npm run db:generate
npm run db:deploy
```

Both migrations were applied to the isolated service and the guarded local
`localhost:5433/mailops` development target. This only records metadata/origins; no
reconstruction of existing development messages was run.

Restart a running development process after generating the updated Prisma client.
The metadata migration does not regroup existing conversations. There is no automatic
down migration that would discard origins. A later forward repair/split must preserve
these records and source evidence.

## Synthetic benchmark method

```bash
docker compose --profile test up -d --wait postgres-test
# Set the explicit isolated TEST_DATABASE_URL from .env.example.
npm run bench:threads
# Optional smaller diagnostic run:
npm run bench:threads -- --sizes 1000 --repetitions 1
```

The benchmark validates loopback DB/role `mailops_test` before connecting, then
creates its **own UUID-named scratch database per scale**. Migrations, truncation,
reseeding and cleanup are confined to that database; no development fallback exists.
Normal completion drops the scratch database. A hard interruption can leave an owned
`mailops_bench_<uuid>` database; inspect/remove that specific scratch database rather
than resetting application data. Do not run other DB/build test suites concurrently
with performance measurements.

`neutral-thread-corpus-v1` generates 1k/10k/50k messages with deterministic UUIDs,
512-character neutral bilingual bodies in both clean/normalized columns, one sender
per message, and expected 10-message groups. All subjects are identical. Reference
chains, selected cycles and deliberately missing references exercise grouping without
relying on subject matching. Insert order is deterministically shuffled. Synthetic
pending classifications exercise query metadata without invoking any model. Approved
synthetic knowledge counts are 100/1,000/5,000, with captured fixture revisions.

Each scale runs in its own Node process. Three database repetitions each start from
reset/reseeded data and `ANALYZE`. One unmeasured planning scan warms data; each query
also has one warm-up followed by three samples per repetition. No OS/PostgreSQL
cache flushing or CPU affinity/frequency control is claimed. After reconstruction,
row visibility, live/dead tuples, selectivity and detail payload shape differ;
post-merge query times are not a controlled index-optimization comparison.

Pure planners run in separate baseline/current child processes with one warm-up and
three samples. Baseline is Git `de0d86c`'s actual original planner; the full history
containing that commit must be available. The regular corpus compares matching
header groups; a separate descending-ID chain isolates the demonstrated recursive
stack limit. The application correctness suite separately covers preservation of
already-established membership, which the old baseline did not implement.

Elapsed times distinguish pure planning from database snapshot/manifest preparation
and full atomic application (including before/after signature scans and receipt).
Memory reports process `maxRSS` in bytes and live heap deltas after requested GC.
Peaks include process setup, warm-ups and seeding and are cumulative over that
worker's repetitions; heap deltas are not exact peak allocation or retained-memory
measurements. No monetary, production-throughput or cross-machine speedup claim.

Raw results are ignored in `data/benchmarks/phase-5-results.json`; the versioned
synthetic-only summary is in `benchmarks/phase-5-summary.json`. The recorded report
includes hardware, PostgreSQL settings, code hash, raw samples, cache conditions,
query response bounds and retrieval `EXPLAIN (ANALYZE, BUFFERS)` evidence.

## Measurements and engineering decision

See [the measured performance report](16-phase-5-performance-report.md) for actual
values, including slower ordinary-case pure planning and any query regressions.
The only algorithm change justified as an optimization is the demonstrated deep
chain stack failure: iterative path compression and union by size remove recursive
call depth. Validation and preserved-membership checks add ordinary-case overhead.
No extra infrastructure/index is introduced merely to imply a speedup.

The measured local corpus supports keeping a full rebuild for explicitly scheduled
MVP maintenance. It does not justify an incremental worker yet. Revisit incremental
reconstruction when measured write availability, body/history sizes or latency goals
exceed these limits. The apply lock window must not be treated as acceptable for
an unmeasured production workload.

## Verification and acceptance mapping

- Planner tests: neutral expected memberships, input-order independence, missing
  parents, cycles/self references, existing membership, undated deterministic root
  choice, duplicate identity rejection, and a 50k adversarial chain.
- Integration tests: apply/replay/no-change; late parent reconciliation; import-order
  equivalence and equal-subject isolation; confirmed/immutable/source/ticket/dispatch
  preservation; original message ownership through repeated merges; stale plans;
  checksum tampering; identity/sending blocks; real database rollback; concurrent
  applications; outbound-only context; CLI plan/apply/inspect and safe errors.
- Inbox/browser regression: old bookmarks open the canonical conversation, preserve
  all messages and search member subjects without executing AI on rendering/refresh.
- P5-A1 maps to planner/import-order tests; P5-A2 to stale/replay/concurrency/rollback;
  P5-A3 to origins, record attribution and context/dispatch guards; P5-A4–A5 to the
  recorded method, baseline/current samples and disclosed practical limits.

- `npm run check`: lint, TypeScript, **128 offline tests in 30 files**, and production build passed.
- Complete isolated regression: **93 integration tests in 20 files passed**, sentinel unchanged.
  The older-schema upgrade through both new migrations also passed separately.
- `npm run test:e2e`: **7 browser workflows passed**, including canonical old-link navigation.
- `npm run bench:threads`: all three scales and repetitions completed with expected memberships/replay.
- Prisma generation/validation and migration/schema comparison passed; final diff and documentation checked.

Phase completion is recorded in the implementation plan.
No real provider calls or production reconstruction were performed.
