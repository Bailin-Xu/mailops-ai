# MailOps AI — Code Inventory and Career Implementation Plan

Assessment date: **2026-10-27**.

Status: **Phases 0 and 1 complete (2026-10-27); Phases 2–5 not started.**

## 1. Purpose and Scope

Improve the existing MailOps project for three portfolio directions: AI application
development, full-stack development, and backend development. Maintain one coherent
codebase, with different demonstrations and evidence for each direction.

This document records the code review findings and the agreed order of work. Saving
this plan does not implement its features or authorize deployment, mailbox access,
real sending, or other deferred integrations. Business code remains unchanged by
this documentation task.

### Relationship to other documents

- [AGENTS.md](../AGENTS.md) continues to govern development and scope restrictions.
- [MVP requirements](01-mvp-requirements-refactored.md) describe current functional
  requirements. References below use that file's requirement IDs. The older
  `docs/01-mvp-requirements.md` path does not exist; Phase 0 corrected the AGENTS.md reference.
- [AI and knowledge design](04-ai-and-knowledge-design.md) describes the trust and
  provider boundaries.
- [Productization roadmap](07-productization-requirements-and-roadmap.md) and
  [agentic roadmap](08-agentic-orchestration-design-and-roadmap.md) remain future
  designs. Their Gmail, deployment, and multi-agent targets are not completed
  features or prerequisites for the phases below.
- For this portfolio improvement effort, use the phase order in this document.
  Reconcile conflicting requirement details explicitly during Phase 0; do not
  silently expand scope or treat roadmap text as implementation evidence.

## 2. Assessment Method and Verification Limits

The review inspected application pages and server actions, business services,
Prisma schema and migrations, AI adapters, evaluation scripts, and tests.

**Implemented** below means code exists and its call path was inspected. It does
not mean that every database or browser workflow was executed during the review.
Potential concurrency and stale-state failures are code-review findings; they
still require reproducing regression tests in an isolated database.

Checks actually run during the assessment:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `./node_modules/.bin/tsc --noEmit --incremental false` | Passed |
| `./node_modules/.bin/vitest run --exclude '**/*.integration.test.ts'` | 26 files, 94 tests passed |
| Database integration tests | Not run: tests use the configured database and write/delete records; some update global safety controls |
| Live-model evaluations | Not run; no model-quality result is claimed |
| Browser end-to-end tests | Not run; no Playwright setup found in the inspected project |
| Production build | Not run in the read-only assessment |

These are historical assessment results, not acceptance evidence for future code
changes. Each implementation phase must run its own required checks.

## 3. Current Capability Inventory

### 3.1 Implemented capabilities

| Capability | Actual behavior | Evidence and boundary |
| --- | --- | --- |
| EML parsing | Validates extension, size, and recognizable headers; extracts participants, bodies, references, and attachment metadata; preserves French characters | [parser](../lib/email/parser.ts), [parser tests](../lib/email/parser.test.ts). HTML is converted to text; the UI does not render raw email HTML |
| Import and duplicate detection | Uses Message-ID and a content fingerprint, transactional inserts, and unique-conflict recovery | [ingestion](../lib/email/ingestion.ts). Script/service entry point; no browser upload workflow |
| Body preparation | Determines inbound/outbound direction, cleans reply text, and retains selected quoted context | [email modules](../lib/email), [historical assessment](../lib/knowledge/historical-source-assessment.ts). Some rules remain domain-specific |
| Inbox and thread display | Search, processing-state filters, URL selection, message timeline, and incomplete-thread indicator | [inbox page](../app/inbox/page.tsx), [queue](../lib/inbox/queue.ts). Display supports multiple messages, but import does not yet apply reconstruction |
| AI boundary | Mock and Gemini implementations behind an interface; structured output, Zod validation, timeout handling, and execution metadata | [provider interface](../lib/ai/provider.ts), [Gemini adapter](../lib/ai/gemini-provider.ts). Fixed application workflow, not dynamic agent tool execution |
| Classification and correction | Routes confidence at or above 0.70 automatically except MANUAL_REVIEW; retains original AI output separately from human correction | [classification service](../lib/classification/service.ts). AIR-013 and AIR-014 |
| Knowledge source and candidate review | Reviews historical sources, imports candidates, edits/approves/rejects them, supports bulk approval and splitting with lineage | [candidate import](../lib/knowledge/candidate-import.ts), [candidate review](../lib/knowledge/candidate-review.ts), [split](../lib/knowledge/candidate-split.ts). Candidate creation is primarily deterministic extraction and preparation |
| Approved-knowledge search | English/French PostgreSQL full-text search, field weighting, category bonus, and ACTIVE-only filtering | [search](../lib/knowledge/search.ts). No vector retrieval |
| Grounded draft preparation | Selects one qualifying source, rejects unprovided source IDs, and falls back to a human when no source qualifies | [processing service](../lib/processing/service.ts). Citation membership is validated; factual entailment is not |
| Human confirmation and simulation | Stores original AI draft and final approved text separately; records simulated sending; human answers may create unapproved knowledge candidates | [processing service](../lib/processing/service.ts), [review panel](../app/inbox/classification-panel.tsx). No external delivery |
| Execution records and test fixtures | Stores model, prompt version, latency, tokens when available, validation and failure metadata; includes synthetic scenarios and holdout cases | [schema](../prisma/schema.prisma), [evaluation modules](../lib/evaluation). No complete experiment comparison or quality-gate system |

### 3.2 Existing foundations that are not complete product workflows

| Foundation | Implemented portion | Missing closure |
| --- | --- | --- |
| Thread reconstruction | Union-find planner; tests for chained replies, missing references, cycles, and input-order independence | [planner](../lib/email/thread-reconstruction.ts) is used by a dry-run script; no application step updates stored thread membership |
| Reply dispatch | Scheduling, unique dispatch identity, conditional claiming, retry bookkeeping, safety controls, and audit events | [dispatch service](../lib/automation/reply-dispatch.ts) is not the inbox's simulated-send path; no complete delivery worker/recovery workflow |
| Automation state machine | Allowed transition helper and tests | [state machine](../lib/automation/state-machine.ts) is not centrally enforced by all state-writing services |
| Technical ticket handling | Create, simulated forward, claim, resolve, and audit services | [bug service](../lib/bugs/service.ts) is not wired into the inbox's simple simulated-forward marker |
| Provider integration contracts | Inbound/outbound schemas and simulated delivery adapters | [email provider](../lib/integrations/email-provider.ts) is not a Gmail synchronization implementation |

Preserve these foundations. Do not expand dispatch or technical-ticket
infrastructure merely to produce another reliability story already covered by
work experience.

## 4. Improvements and New Capabilities

### 4.1 Existing behavior to improve

| ID | Finding | Required improvement |
| --- | --- | --- |
| IMP-01 | Simulated send checks GENERATED state, but not whether the draft belongs to the latest classification or still-valid grounding | Validate current classification, inbound context, and knowledge eligibility before confirmation; reject stale submissions |
| IMP-02 | Processing supersedes generated drafts before replacement generation succeeds | Preserve previous output on failure; atomically activate a successful replacement. A preserved draft must still pass current validity checks before use |
| IMP-03 | Some review/manual-answer paths read state then update without a version condition | Add conditional transitions or revision checks and deterministic duplicate/concurrent submission behavior |
| IMP-04 | Knowledge approval updates the same KnowledgeEntry; draft links identify an entry, not the version used | Introduce immutable approved revisions and explicit draft evidence snapshots |
| IMP-05 | Draft editing and confirmation are combined; independent save/reject/approval states are incomplete | Reconcile FR-076 and FR-080 with the minimal review lifecycle, then implement only the agreed states |
| IMP-06 | Inbox loads all matching threads and messages; candidate lists are also unpaged | Apply database-side filtering/pagination and separate list summaries from selected-detail queries |
| IMP-07 | Evaluation primarily checks route/status and presence of drafts; holdout reuses existing classifications; failed cases only affect printed counts | Separate run identities and resume semantics, add content/retrieval scoring, and return failure when configured gates fail |
| IMP-08 | Fixed reply style, vocabulary, and domain-specific fields appear in core paths | Separate general behavior from configuration and neutral synthetic demonstration data; avoid a broad speculative refactor |

### 4.2 New capabilities to add within this plan

| ID | Capability | Minimal deliverable |
| --- | --- | --- |
| NEW-01 | Versioned knowledge and draft provenance | Immutable knowledge revisions, draft-to-revision references, and affected-draft detection |
| NEW-02 | Independent evaluation runs | Run identity and dataset/knowledge/model/prompt/retrieval configuration manifest; separate new-run and resume modes |
| NEW-03 | Evaluation scorecards | Routing, escalation, retrieval, factual support, language, latency, and token reporting with case-level evidence |
| NEW-04 | Knowledge revision review UI | Revision comparison, conflict feedback, history, and affected drafts |
| NEW-05 | Browser workflow tests | Deterministic mock-based Playwright coverage for review, conflicts, failure recovery, and simulation |
| NEW-06 | Reproducible performance benchmarks | Synthetic data generator and reports for reconstruction, inbox queries, and retrieval |
| NEW-07 | Isolated database tests and CI | Dedicated test database, safe initialization/cleanup, and automated quality checks |

### 4.3 Deferred features

Gmail/Graph/SMTP, real synchronization or sending, authentication/RBAC,
multi-tenancy, production workers, external Discord, cloud deployment, attachment
content processing, vector search, dynamic tool-calling agents, multi-agent
orchestration, and OpenTelemetry expansion are not part of these phases.

Existing future roadmap designs remain available for later explicit decisions.
An evaluation report may motivate a later retrieval or agent experiment; it does
not automatically authorize that scope expansion. Do not list these features as
completed portfolio work without implementation and verification evidence.

## 5. Career Direction and Priority

P0 means a shared correctness or reproducibility prerequisite. P1 means a primary
demonstration for that direction. P2 means useful follow-up after the primary
demonstration works.

| Work item | AI application | Full-stack | Backend |
| --- | --- | --- | --- |
| Stale-draft protection, safe retries, concurrent updates | P0 | P0 | P0 |
| Isolated tests and accurate capability documentation | P0 | P0 | P0 |
| Knowledge revisions and draft evidence | P1 | P1 | P1 |
| Versioned evaluations and baseline comparisons | P1, first specialization | P2 | P2 |
| Revision/conflict/impact user experience | P2 | P1, first specialization | P2 |
| Reconstruction application and relationship integrity | P2 | P2 | P1, first specialization |
| Pagination and query shape | P2 | P1 | P1 |
| Browser workflow verification | P2 | P1 | P2 |
| Scale benchmarks and measured optimization | P2 | P2 | P1 |

Portfolio differentiation:

- **AI application:** demonstrate measurable quality, controlled experiments,
  abstention/escalation, and failure analysis. Avoid repeating the work-experience
  story of integrating RAG and email assistants.
- **Full-stack:** demonstrate knowledge revision, conflict-aware editing, and
  consistent UI/server behavior. Avoid presenting another shared-draft inbox as
  the main achievement.
- **Backend:** demonstrate relationship reconstruction, immutable evidence, data
  invariants, and measured scale behavior. Avoid making resumable dispatch,
  leases, and idempotent sending the project's main story again.

## 6. Phase Sequence and Status

Complete **Phase 0 → Phase 1 → Phase 2**, then select the specialization matching
the current job-search priority. Phases 3, 4, and 5 are not mandatory sequential
dependencies. Shared work, such as pagination, should be implemented once.

| Phase | Objective | Dependency | Status |
| --- | --- | --- | --- |
| 0 | Reproducible development and demo baseline | None | Complete; evidence in Section 8 |
| 1 | Correct state transitions and safe replacement | Phase 0 | Complete; evidence in Section 9 |
| 2 | Versioned knowledge and immutable evidence | Phase 1 | Not started |
| 3 | AI evaluation demonstration | Phase 2 | Not started |
| 4 | Full-stack revision workflow demonstration | Phase 2 | Not started |
| 5 | Backend reconstruction and scale demonstration | Phase 2 | Not started |

### Phase 0 — Reproducible Baseline

**Tasks**

- [x] P0-T1: Reconcile current requirements and implementation, including draft
  states, classification review policy, and the distinction between workflows and
  agents. Record deliberate behavior changes before implementing them.
- [x] P0-T2: Provide neutral synthetic English/French emails and matching approved
  demo knowledge. Make repeated seeding safe and document reset boundaries.
- [x] P0-T3: Separate offline tests, database integration tests, and opt-in live
  model evaluations. Ensure the integration suite includes all integration files.
- [x] P0-T4: Add dedicated test database configuration and fail-closed protections
  against using a development database for cleanup or safety-control changes.
- [x] P0-T5: Add CI for lint, type checking, offline tests, isolated database tests,
  and build. No API key or live model call is required.

**Acceptance criteria**

- P0-A1: A clean local setup can migrate and seed the documented demonstration;
  repeated seeding creates no duplicate demo records.
- P0-A2: Missing or unsafe test database configuration aborts before mutations;
  a sentinel in a separate development database remains unchanged after tests.
- P0-A3: The complete integration test list is exercised in isolation, including
  dispatch/technical-ticket foundation tests; no actual delivery is possible.
- P0-A4: Required checks run without a Gemini key. Documentation clearly separates
  implemented features, partial foundations, and future plans.

**Deliverables:** reproducible setup instructions, neutral fixtures, isolated test
configuration, CI checks, and a short requirements reconciliation record.

### Phase 1 — State Correctness and Safe Retries

**Tasks**

- [x] P1-T1: Define the minimal draft/review transition rules and identify the
  current classification and inbound-message context for each draft.
- [x] P1-T2: Reject confirmation of drafts from superseded classification or
  changed inbound context, and drafts whose required knowledge is no longer active.
- [x] P1-T3: Persist successful replacement drafts before atomically superseding
  previous ones; failed attempts preserve original output and failure metadata.
- [x] P1-T4: Add conditional writes/revision checks to manual answers,
  classification correction, and knowledge review. Define conflict feedback.
- [x] P1-T5: Add regression tests for duplicate submission, concurrent editing,
  model failure, old browser tabs, and terminal-state behavior.

**Acceptance criteria**

- P1-A1: An old tab cannot confirm a draft after its classification or inbound
  context changes; the user receives a recoverable stale-result response.
- P1-A2: Provider/validation failure during regeneration retains the previous
  content and records a failed attempt without falsely showing a new draft ready.
- P1-A3: Concurrent generation cannot activate conflicting replacements for the
  same context. Repeated manual submission does not create duplicate logical replies.
- P1-A4: Concurrent reviewers cannot silently overwrite one another; a rejected
  update does not partially modify related records.
- P1-A5: Successful confirmation preserves exact final subject/body/language and
  remains simulated. Invalid transitions leave related data unchanged.

**Deliverables:** transition rules, focused service changes, conflict responses,
and reproducing regression tests. Do not expand production dispatch infrastructure.

### Phase 2 — Knowledge Versions and Draft Evidence

**Tasks**

- [ ] P2-T1: Design immutable approved knowledge revisions and a current-version
  pointer/status, with explicit Prisma migrations.
- [ ] P2-T2: Capture the actual revision and input context used for draft generation;
  revalidate it if knowledge changes while the model request is in flight.
- [ ] P2-T3: Identify affected pending drafts when a source is revised or retired;
  require explicit re-review or regeneration according to documented rules.
- [ ] P2-T4: Preserve confirmed history; migrate existing data without claiming
  that today's knowledge content was necessarily the historical generation source.
- [ ] P2-T5: Expose revision/history/impact service queries for later UI and
  evaluation work. Keep style configuration separate from factual grounding.

**Acceptance criteria**

- P2-A1: After revision A becomes B, an earlier draft still resolves to A's exact
  factual evidence; a newly generated draft uses eligible revision B.
- P2-A2: Revision/retirement marks affected pending drafts for review, and the
  confirmation endpoint enforces that requirement independently of the UI.
- P2-A3: A knowledge change during generation cannot silently produce a draft
  recorded as using a different revision from the one supplied to the provider.
- P2-A4: Confirmed historical replies remain unchanged. Legacy records lacking a
  provable source snapshot are explicitly marked rather than assigned invented history.
- P2-A5: Migration and rollback/recovery instructions are documented and tested on
  synthetic existing data; source and draft relationships remain intact.

**Deliverables:** revision schema/migration, evidence binding, impact detection,
service queries, and lifecycle tests. This is the shared core for all directions.

### Phase 3 — AI Application Evaluation

**Tasks**

- [ ] P3-T1: Introduce evaluation run identities and manifests for dataset,
  knowledge revisions, provider/model, prompts, retrieval rules, and grading rules.
- [ ] P3-T2: Separate new experiments from interrupted-run resumption. Prevent
  cached classifications from a different configuration from entering a new run.
- [ ] P3-T3: Add English/French cases for known and unknown questions, ambiguity,
  conflicting knowledge, injection attempts, and incorrect response language.
- [ ] P3-T4: Annotate expected routes, relevant source IDs, and supported claims;
  report retrieval Recall@K, routing, missed human escalation, factual support,
  language consistency, latency, and token usage. Explain each metric's denominator.
- [ ] P3-T5: Compare the current deterministic retrieval baseline with a bounded
  prompt or retrieval-rule change. Keep a frozen holdout separate from tuning cases.
- [ ] P3-T6: Produce case-level comparison reports and meaningful failing exit
  codes. Keep live-model runs opt-in and separate from mock CI correctness checks.

**Acceptance criteria**

- P3-A1: Two configurations create distinct runs; resuming the same unchanged run
  does not repeat completed cases or mix results from other configurations.
- P3-A2: Runs use a fixed knowledge snapshot and report both improvements and
  regressions, including false escalation and missed escalation.
- P3-A3: A deliberately failing case or gate returns a nonzero exit code; an
  execution failure is distinguishable from a completed but poor-quality answer.
- P3-A4: Reports include case counts, grading criteria, model/configuration
  versions, and latency/tokens. Missing token metadata is not treated as zero cost.
- P3-A5: Mock results are labeled as software behavior checks, not model quality.
  Model-graded claims have a documented rubric and human spot checks; no fabricated
  accuracy, groundedness, or cost improvement is reported.

**Deliverables:** evaluation runner/manifest, labeled synthetic cases, scorecards,
and a reproducible baseline comparison. Vector search and agent tools remain deferred.

### Phase 4 — Full-Stack Knowledge Revision Workflow

**Tasks**

- [ ] P4-T1: Build revision comparison/history and affected-draft views using Phase
  2 services; display AI suggestions separately from human decisions.
- [ ] P4-T2: Complete agreed save/reject/re-review interactions with revision-aware
  submissions, retained unsaved input, and clear conflict resolution.
- [ ] P4-T3: Paginate inbox/candidate lists, fetch selected details independently,
  and preserve filters, selection, and navigation in URL state where appropriate.
- [ ] P4-T4: Add consistent loading, empty, success, and recoverable error states;
  verify keyboard access and readable English UI with French email content.
- [ ] P4-T5: Add Playwright tests with Mock AI and isolated synthetic database data.

**Acceptance criteria**

- P4-A1: A reviewer can identify an incorrect fact, revise knowledge, inspect the
  diff, see affected drafts, and complete re-review without database tools.
- P4-A2: Two tabs editing the same revision receive an explicit conflict instead
  of silent overwrite; a failed submission preserves the user's proposed text.
- P4-A3: List queries fetch bounded summaries, not every thread's full message
  history. Pagination/filter changes and browser back/refresh restore valid state.
- P4-A4: Browser tests cover the successful flow, stale edits, provider failure,
  and simulated confirmation. All run without external email or model services.
- P4-A5: Refreshing or ordinary page rendering does not trigger model calls;
  untrusted email HTML and remote tracking images are not rendered.

**Deliverables:** complete revision workflow, paginated views, browser tests,
and a short reproducible product demonstration.

### Phase 5 — Backend Thread Reconstruction and Scale

**Tasks**

- [ ] P5-T1: Define how reconstruction preserves thread identity and associated
  classifications, drafts, knowledge sources, dispatch records, and tickets.
- [ ] P5-T2: Add a validated apply step to the existing planner, with consistency
  checks when messages change between planning and application.
- [ ] P5-T3: Handle out-of-order imports, missing parents later arriving, cycles,
  and repeated execution; preserve lineage instead of silently losing old records.
- [ ] P5-T4: Generate neutral synthetic datasets at documented scales, initially
  1k/10k/50k messages where local resources permit, with expected thread membership.
- [ ] P5-T5: Measure reconstruction time/memory and inbox/retrieval query behavior.
  Reuse Phase 4 pagination if implemented; otherwise add the same bounded query layer.
- [ ] P5-T6: Optimize only demonstrated bottlenecks; document whether full rebuild
  is sufficient or an incremental strategy is justified.

**Acceptance criteria**

- P5-A1: Different import orders yield the same message grouping; missing parents
  are reconciled when they arrive; unrelated equal-subject messages are not merged.
- P5-A2: Reapplying an unchanged plan makes no logical changes; stale plans are
  rejected or safely recomputed. Failure leaves no partially moved relationship graph.
- P5-A3: Existing classifications, draft evidence, candidates, dispatches, and
  tickets remain reachable and correctly attributed after merging. Changed inbound
  context invalidates pending drafts through the Phase 1/2 rules.
- P5-A4: Benchmarks disclose hardware, data generation, sizes, repetitions, cache
  conditions, elapsed time, and memory. Unsupported scales are reported as limits.
- P5-A5: Before/after measurements use comparable conditions and preserve the
  correctness suite; no throughput or latency improvement is claimed without results.

**Deliverables:** safe reconstruction application, integrity tests, benchmark
fixtures/runner, and a performance report with practical limits.

## 7. Phase Completion and Handoff Rules

For each implementation phase:

1. Inspect current code and Git state; select the relevant task IDs from this plan.
2. Implement a small coherent change without unrelated refactoring. Add new tables
   only when their phase needs them, and use migrations rather than editing history.
3. Add meaningful tests for the acceptance scenarios. Run `npm run check`, isolated
   database integration tests when relevant, and Playwright for changed UI workflows.
   Report every failed, skipped, or unavailable check with its reason.
4. Review the final diff and confirm no real email, secrets, or generated runtime
   artifacts enter the intended change set. Do not commit or push unless requested.
5. Update the phase status and checkboxes only after recording acceptance evidence.
   A design document or a passing unrelated test is not feature completion.
6. Summarize files changed, implemented behavior, checks, unresolved limitations,
   and the next eligible phase. Update resume claims only from verified evidence.

Use the following evidence fields when closing a phase:

| Field | Required record |
| --- | --- |
| Phase and completion date | Phase number and actual verification date |
| Tasks completed | Task IDs and any intentionally deferred items |
| Acceptance evidence | Criterion ID mapped to tests, demo steps, or report paths |
| Checks | Commands, results, and reasons for omissions |
| Migration/data impact | Migration identifiers and tested data boundaries, if applicable |
| Limitations | Known risks, unverified behavior, and scope exclusions |
| Next step | Eligible phase or explicitly scoped follow-up |

**Next planned implementation step: Phase 2.** Phases 2–5 remain unstarted.

## 8. Phase 0 Closure — 2026-10-27

Tasks P0-T1 through P0-T5 are complete. The detailed setup, requirements
reconciliation, demo routes, and reset boundaries are in the
[Phase 0 baseline guide](10-phase-0-baseline-and-verification.md).

| Criterion | Acceptance evidence |
| --- | --- |
| P0-A1 | All 18 existing migrations applied to a fresh disposable PostgreSQL 17 database. `npm run demo:seed` executed twice against that test database: first `{imported:4, duplicate:0, aiCalls:0}`, then `{imported:0, duplicate:4, aiCalls:0}`. The integration test additionally verifies two knowledge records/approval events, preservation of later edits, English/French grounded drafts, and manual/technical fallbacks |
| P0-A2 | `tests/database-target.test.ts` verifies missing/unsafe targets, query override rejection, and same-database detection. `tests/database-isolation.integration.test.ts` verifies runner refusal before migrations. The runner's separate synthetic development-sentinel database retained its marker throughout the full suite. The actual development database was not used |
| P0-A3 | `npm run test:integration`: 12 files / 30 tests passed, including the previously omitted dispatch/ticket foundation suite and the new demo/isolation tests. Both test configurations block external fetch; Mock/injected providers are used |
| P0-A4 | Complete `npm run check` passed: lint, type checking, 27 offline files / 106 tests, and production build. Run with Mock AI, empty Gemini key/model, delivery disabled, and an unreachable placeholder application DATABASE_URL. Current/partial/future capabilities are distinguished in the baseline guide and reconciled requirements |

Implementation files include the split Vitest configurations and setup files,
`tests/support/database-target.mts`, the integration runner, neutral demo seed and
fixtures, the dedicated Compose test service, and `.github/workflows/check.yml`.
No dependencies, business-service code, schema, or migrations were changed.

Verification notes and limitations:

- The first restricted-environment build failed because Turbopack could not bind
  its temporary local port. The build and then the full check passed when rerun
  with the required local execution permission; no application workaround was added.
- An initial demo test used bracketed Message-IDs instead of normalized stored
  IDs. It was corrected, an explicit four-message assertion was added, and the
  final integration suite passed from a freshly recreated test database.
- GitHub Actions is configured; a remote CI run has not occurred because no Git
  commit or push was requested. Local verification ran on Node.js 24.3.0;
  the workflow specifies Node.js 22, whose hosted result remains unverified.
- No live Gemini evaluation or browser end-to-end test ran. Neither is needed for
  the Phase 0 infrastructure change; model quality and browser workflows remain
  later phase work. The existing fixed sample reply style also remains unchanged.
- The disposable test service was used for migrations, tests, and CLI seed smoke
  checks. Its temporary data can be discarded by stopping that service, independently
  of the development database and persistent volume.
- No Git commit or push was made. The pre-existing productization/agentic roadmap
  files were not modified by Phase 0.

## 9. Phase 1 Closure — 2026-10-27

Tasks P1-T1 through P1-T5 are complete. Transition rules, concurrency policy,
historical-data handling, and criterion-to-test mappings are recorded in the
[Phase 1 verification guide](11-phase-1-state-consistency-and-verification.md).

- Validity markers bind classifications to inbound context and drafts to the
  classification revision and unchanged active knowledge. Legacy pending data
  lacking proof requires explicit reclassification; confirmed history is retained.
- Successful replacements supersede old drafts atomically. Failed attempts preserve
  content, record validation/failure metadata, and cannot overwrite newer work.
- Conditional writes and serializable transactions protect reviews, manual answers,
  replacements, and simulated confirmations. Stale submissions receive recoverable
  feedback. False spam results remain human-correctable.
- `npm run check` passed: lint, types, **112 offline tests**, and production build.
  The full isolated integration suite passed **61 tests in 14 files** with its
  database sentinel unchanged. Prisma generation/schema validation also passed.
- Migration `20261027183000_add_workflow_consistency` was tested from a fresh
  isolated database and then applied to the guarded local development database.
  It adds metadata only and does not invent historical provenance.
- UI revision-token plumbing and regeneration feedback were implemented; browser
  end-to-end tests remain unrun because Playwright is not configured. Immutable
  knowledge revisions and richer conflict UI remain Phases 2 and 4 respectively.
- No Git commit/push or live model call was made for this phase. The pre-existing
  `07`/`08` roadmap files remain untouched.
