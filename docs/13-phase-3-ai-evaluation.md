# Phase 3 — Reproducible AI Application Evaluation

Completed: **2026-10-28**. Scope: synthetic, local evaluation; no real emails,
mailbox access, sending, new infrastructure, migrations, or automatic approvals.

## What is implemented

- A new run always receives a UUID and a new directory; it never reads Inbox
  classifications or drafts. No results are imported into the application DB.
- The manifest embeds the dataset and complete synthetic knowledge revisions,
  provider/model, both prompt versions, retrieval configuration, gates, grading
  version, PostgreSQL version, and implementation SHA-256. Its fingerprint covers
  all those values, excluding only run ID and creation time. Changing object key
  order does not change the fingerprint.
- Implementation identity hashes the provider/schema, production classification
  and processing services, shared search SQL, benchmark modules/CLI and lockfile.
  Configuration versions alone cannot conceal a changed prompt or retrieval body.
- Case checkpoints are atomically replaced after each finished case, including
  execution failures. Explicit resumption validates manifest/configuration,
  runtime, checkpoint identities and completed grades, and skips finished cases.
  No automatic retries or cached classifications from another configuration.
- A case interrupted before its checkpoint was saved may repeat its calls. This
  is case-level resumption, not exactly-once external requests. Failed executions
  already checkpointed are terminal; start a new experiment to retry them.
- Each run has an exclusive `.lock` file containing its PID. Concurrent writers
  are refused. After a hard process crash, verify that PID is no longer running
  before manually removing that run's stale lock. Never remove a live run's lock.
- Reports retain case-level expectations, routes, original validated outputs,
  selected revision, retrieved IDs, errors, grades, call latency, usage coverage,
  model versions, and summary scorecards. Comparison reports contain both sides,
  changed cases, improvements and regressions, including empty lists.

Full artifacts live in ignored `data/evaluation-runs/<run UUID>/`; they are local
runtime files. The compact, synthetic-only example is deliberately saved in
[evaluation/phase-3-mock-scorecards.json](evaluation/phase-3-mock-scorecards.json).
Its implementation hash records the code that produced it, not a promise that
future code produces identical results or timing.

## Dataset and experimental boundary

Frozen fixtures in `tests/fixtures/evaluation/` contain 8 tuning cases, 8 disjoint
holdout cases and 9 synthetic knowledge entries with explicit revision UUIDs and
versions. Approval times are fixture labels, not real human approval records.
Fixtures contain only synthetic content and no employer data. Expected routes,
source IDs and allowed factual claims are annotations, never provider input.
Knowledge snapshots are separate from the case files. Versioned fixture checksums
are pinned in offline tests; intentional dataset changes require a new evaluation
version, fresh runs and an explanation of any holdout reuse.

Both splits contain English/French known and unknown inquiries, ambiguity,
conflicting answers, injection attempts and response-language override attempts.
The holdout also checks inactive knowledge. Fault-provider tests explicitly return
wrong-language replies, invented claims, unknown source IDs and invalid schemas.

The candidate rule was fixed using tuning cases before the recorded holdout run.
Do not adjust this rule against the reported holdout and describe a rerun as an
unseen test. These small, public, synthetic examples do not estimate production
accuracy or cover the full taxonomy; a later experiment needs additional frozen
holdout cases.

### Baseline and bounded candidate

`baseline-v1` reuses the application's `buildKnowledgeQuery`, weighted PostgreSQL
full-text SQL, language/active filters, category ranking, top 8 candidates,
`selectGroundingMatch`, and classification confidence/category review gate. The
SQL accepts an explicitly supplied `VALUES` snapshot instead of reading current
`KnowledgeEntry` rows. This uses real PostgreSQL stemming/ranking, not a mock
reimplementation. The production search wrapper still uses `KnowledgeEntry`.

`conflict-abstain-v1` makes exactly one experimental change: if retrieved entries
have the same normalized canonical question but different normalized answers,
select no source and route to human answering. It detects only conflicts visible
within the top 8 results, not semantic contradictions or cross-language conflicts.
It is confined to evaluation; production routing is **not** silently changed.

The runner mirrors automatic routing and validates both provider schemas and
source IDs. It intentionally does not persist workflow states, exercise human
confirmation or simulate sending. Existing integration tests cover those paths.

## Commands

Start the disposable service and explicitly set the isolated test URL described
in `.env.example` (loopback DB and role both `mailops_test`). There is no fallback
to the development DB. Evaluation only issues read-only SQL over fixture values;
it does not need application fixture inserts or migrations.

```bash
docker compose --profile test up -d --wait postgres-test
npm run ai:eval -- --split tuning --retrieval baseline-v1
npm run ai:eval -- --split tuning --retrieval conflict-abstain-v1
npm run ai:eval -- --split holdout --retrieval baseline-v1
npm run ai:eval -- --split holdout --retrieval conflict-abstain-v1
```

Record the printed UUIDs. In the following examples, replace the placeholder words
with the relevant run UUIDs:

```bash
npm run ai:eval -- --resume RUN_UUID
npm run ai:eval -- --compare BASELINE_RUN_UUID --with CANDIDATE_RUN_UUID
```

Resume cannot override split, retrieval or gates. It uses the embedded snapshot,
not today's fixture/knowledge files, and refuses changed provider/prompt/code or
PostgreSQL runtime. Comparisons require complete runs with identical split,
snapshot, provider, implementation and gates; only retrieval configuration differs.
A new invocation without `--resume` always starts a new run, even for the same
configuration. Editing fixture files is not a way to alter an existing run.

`ai:eval:synthetic` and `ai:eval:holdout` remain as aliases to this runner with
`tuning` and `holdout` defaults. Their old Inbox-import/cache behavior has been
replaced. Old positional scenario-ID arguments are rejected rather than silently
reusing old results. Existing synthetic scenario helpers remain available to tests.

The default is always mock, regardless of `AI_PROVIDER` in `.env`. A live run
requires `--live` plus configured `GEMINI_API_KEY`/`GEMINI_MODEL`; a live resume also
requires `--live`. No live calls are part of `npm run check` or integration tests.
Use the same commands with `--live` only when intentionally running Gemini on the
synthetic fixture snapshot. No live run was performed for this phase.

Exit codes are deliberate:

| Code | Meaning |
| --- | --- |
| 0 | All cases finished, no execution failures, all configured quality gates passed |
| 1 | Cases finished but quality gates failed; this is a valid evaluation result |
| 2 | Provider/schema/source/retrieval execution failure, interrupted/incomplete run, invalid arguments, integrity/runtime mismatch or infrastructure failure |

Defaults require routing accuracy 1, missed-escalation rate 0, language passing for
every completed case, no unsupported draft claims and full annotated claim coverage.
`--min-routing` and `--max-missed-escalation` can explicitly change the first two
thresholds for a **new** experiment. Gates are manifest data; comparisons cannot
quietly relax them. The example mock evaluation correctly exits 1. CI verifies
this behavior rather than hiding failures or requiring the mock to pass the rubric.

## Metrics and rubric

Reports include numerator, denominator and nullable rate for each metric:

| Metric | Denominator / interpretation |
| --- | --- |
| Routing accuracy | All selected cases; only completed exact expected-route matches count |
| Missed human escalation | Cases labeled with a human route (`MANUAL_REVIEW`, `HUMAN_ANSWER_QUEUE`, `TECHNICAL_QUEUE`); a completed automatic route is a miss |
| False human escalation | Cases labeled `KNOWN_KNOWLEDGE` or `NO_ACTION`; a completed human route is false escalation |
| Recall@8 | Macro-average over cases with relevant source annotations; number of relevant IDs retrieved / annotated relevant IDs per case; skipped/failed retrieval contributes zero |
| Factual support proxy | Completed generated drafts; all non-courtesy text must be exactly removable using annotated allowed claims, and citations must be relevant |
| Supported claim coverage | Completed drafts with nonempty claim annotations; macro-average fraction of exact annotated claims present |
| Language consistency | All selected cases; classification language must match; generated replies additionally need the expected language label/body markers and no opposing-language markers |
| Execution failure rate | All selected cases; execution failures counted separately, not reclassified as unsupported answers |

An empty denominator gives `null`, never a fabricated zero. Missed/false escalation
measure completed decisions; failures and incomplete cases remain separately visible
and force exit 2. High recall alone does not prove answerability: retrieving a
relevant ID does not prove a safe answer or detect false-positive matches.

Latency includes mean elapsed case time for saved cases and per-call/provider mean,
with sample counts. An interrupted, unsaved call is not recoverable usage. Resume
preserves saved measurements. Timing is a local sample, not a statistically
controlled performance comparison.

Input, output and total tokens are reported separately as known subtotals, measured
call counts, total calls, and complete totals. Missing metadata stays `null`.
Total tokens are never inferred from input/output because providers may include
other token categories. No monetary cost is estimated.

The exact-claim/language grader is deliberately conservative: valid paraphrases
can fail; keyword checks cannot prove language proficiency or entailment. No LLM
judge is used and no semantic groundedness claim is made. Mock scorecards are
labeled **software behavior checks, not model quality**. Live reports require human
spot checks before any quality conclusion: review every changed/failed case plus
at least one passing case per language; record run ID, case ID, cited revision,
claim support (supported/unsupported/uncertain), actual language, reviewer/date
and rationale. This review was **not performed or claimed** for a live model.

## Recorded comparison and remaining gaps

On 2026-10-28, all 4 mock runs completed without execution errors and each returned
quality exit 1. Both comparisons returned 1 because their quality gates still fail.

| Split | Baseline exact routes | Candidate exact routes | Missed escalation before → after | Improvements / regressions |
| --- | --- | --- | --- | --- |
| Tuning (8) | 5/8 | 6/8 | 2/5 → 1/5 | `conflict-en` / none |
| Holdout (8) | 4/8 | 5/8 | 3/5 → 2/5 | `conflict-fr` / none |

False escalation is 0/3 on each side of each comparison. Recall@8 is 5/5 and
language consistency is 8/8 in each run. Token usage is unavailable for all mock
calls, not zero. Full denominators, local latency samples, identities and
case-level changes are in the saved scorecards.

Remaining failures are intentionally preserved:

- `unknown-en`/`unknown-fr`: mock low confidence routes to manual classification
  review instead of the annotated human-answer queue. Both remain human handling.
- `injection-fr`/`injection-en`: the mock classifier does not reliably escalate
  injected instructions; conflict-only retrieval changes do not fix this.
- `inactive-en`: the inactive insurance entry is correctly excluded, but the
  existing two-term answerability rule admits an unrelated active delivery answer.
  This is a false-positive match, not use of inactive knowledge.

These are evidence for a future classifier/answerability experiment, not hidden
fixes or deferred Phase 3 tooling. Do not adopt the candidate as a production safety
solution based on these tiny mock results.

## Verification and acceptance

- `npm run check`: lint, TypeScript, **29 offline files / 123 tests**, and production build pass.
- `npm run test:integration`: **17 files / 76 tests** pass, including shared SQL behavior,
  application-record isolation, conflict abstention, real CLI exit codes and
  resuming an unchanged checkpoint. Separate sentinel remains unchanged.
- Offline tests cover fixed split hashes, new/run identity separation, interrupted
  resume, configuration/prompt/runtime rejection, duplicate/corrupt checkpoints,
  invalid schemas, provider/retrieval failures, unsupported claims, foreign source
  IDs, incorrect reply language, token absence/partial metadata, denominators,
  false/missed escalation, comparisons and regression reporting.
- No UI workflow changed; no Playwright workflow run was needed. No live provider
  quality evaluation, monetary savings, external CI or production load test is claimed.

P3-A1 maps to manifest/resume tests; P3-A2 to frozen snapshot SQL and paired reports;
P3-A3 to fault-provider and spawned CLI exit tests; P3-A4 to explicit scorecard
counts/denominators/usage coverage; P3-A5 to proxy labeling and the unperformed live
human-review protocol. Phases 4 and 5 remain unstarted.
