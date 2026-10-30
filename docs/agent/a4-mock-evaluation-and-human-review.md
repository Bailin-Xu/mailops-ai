# A4 — Mock comparison and human-review preparation

Date: 2026-10-30. Status: mock rehearsal implemented; A4 remains in progress.

## User steering and completion boundary

The user explicitly deferred real models and will perform human review. This run
made no model API calls, no external trace exports and incurred no model charges.
A future low-cost model/provider must be verified for API availability/pricing and
budgeted separately; the user's example model name is not treated as a verified API ID.
The older Gemini target is not authorization to make live calls now.

Completed: mock paired execution, frozen manifests/results, trace artifacts,
blinded scoring packets, human calibration material, review import/consistency checks
and regression tests. Pending: human label/French calibration, actual human ratings,
live model baseline/Agent experiment, calibrated quality gates, complete live budget/
resume coordination and external tracing evidence. A4 is NOT marked complete.

## Rehearsal implementation

`agent:eval:mock` runs two repetitions over the 40 frozen holdout cases, alternating
baseline/Agent order by repetition, producing 160 records (80 per system). It refuses
all CLI arguments and A4_LIVE=true before opening connections. The Python evaluation
worker also refuses live mode. Default environment provider choices do not override
the explicitly instantiated mock providers.

Baseline reuses the existing TypeScript evaluateCase, baseline-v1 selection and
snapshotRetriever. The A0 corpus is adapted to that runner's legacy schema with its
original hash retained in an outer manifest. Family-only annotation fields are
removed before strict manifest fingerprinting. The old Phase 3 comparator and
resume integrity checks remain unchanged.

Agent uses the current bounded LangGraph via the real Python MCP client and TS MCP
HTTP server. Both systems retrieve from the SAME complete frozen knowledge corpus;
ACTIVE-only English/French SQL is shared with production. Evaluation corpus mode
widens retrieval only; the current thread remains scoped to the selected case.
Default family-scoped MCP fixtures remain unchanged and separately tested.

The two mock providers have different deterministic behavior; these are wiring
checks, not a controlled real-model quality experiment. Model IDs/prompt/graph/policy
versions and implementation/dependency hashes are recorded. Local latency includes
Python subprocess/MCP startup for the Agent; do not use it to claim inference-speed
improvement or regression. No prompt/heuristic tuning on holdout was performed.

Every case result is checkpointed as an atomic file replacement. This version does
not automatically resume incomplete comparisons: their completed records remain
available, and a new invocation gets a new UUID. Full cross-system live-run resume
and paid-call reservation are remaining A4 work, not a completed feature.

Artifacts under ignored data/agent-runs include manifest, baseline manifest,
results, per-case baseline/Agent traces, status, scorecard and review packets.
Manifest hashes bind result and original-review contents. Human import refuses
changed evidence, missing/duplicate review rows, foreign/duplicate result ratings,
invalid fields or empty reviewer/reason. Only `rating` is editable in scoring packets.
These are local consistency hashes, not authentication against a malicious file owner.

## Metrics and human blanks

The current diagnostic scorecard exposes case/failure counts, routing label matches,
first-search Recall@8, final evidence-union recall and nullable token totals.
First-search and union metrics have separate definitions/tests. Missing usage remains
null. Human support and qualityPassed remain null until actual review; no judge or
assistant fills human fields. Mock scores cannot satisfy live-model release gates.
Full semantic/human rubric aggregation, calibrated live quality gates and broader
safety/latency/cost reporting are not represented as finished here.

Human packets contain randomized UUIDs and hash-ordered rows without system names,
plus input, output and selected source evidence. Output style may still identify a
system; this is presentation blinding, not a claim of complete experimental blinding.
Use the separate calibration packet's caseId/family reference knowledge when checking
irrelevant citations or no-answer/escalation decisions. Raw result files expose
system identity; avoid them until blinded review is complete when practical.

## Recorded rehearsal evidence

Canonical corrected mock run: **f5847f03-1b7d-4103-84c3-d9f79cfe55d6**.
See [sanitized summary](../evaluation/a4-mock-rehearsal.json).

- 160 records completed; baseline 0 execution failures / 80, Agent 0 / 80.
- Human ratings: **0 / 160**; label/French calibration pending the user.
- Diagnostic routing matches: baseline 24/80, Agent 32/80. First-search Recall@8:
  baseline 0.142857, Agent 0. These reflect deterministic mock behavior and
  uncalibrated labels. They are NOT a real-model improvement claim.
- Token usage and supported-draft ratings are null; qualityPassed is null.
- Early failed rehearsals are retained and summarized: strict manifest validation
  rejected extra annotation fields; a corpus-mode thread-selection bug made the
  Agent fail closed. Both were corrected and regression-tested. The failed runs
  are not the canonical human-scoring run.

## Human review order

1. Start with `data/agent-runs/a4-preflight/label-review.md` (readable) and the adjacent
   label-review.json. Review all 100 cases and their reference knowledge. Fill actual
   reviewerId/completedAt and case labelCorrect/frenchAcceptable/notes. English cases
   may note French not applicable. Record correction requests; do not edit the frozen
   corpus in place. Corrections require a new version/hash before future live runs.
2. The corrected run directory contains review-pack.md for reading and review-pack.json
   for scoring. Each `rating` starts null. Fill the five rubric booleans and a reason:
   support, citations, completeness, language and safety, plus actual reviewerId.
   Do not change row IDs, result hashes, inputs or outputs. User feedback can be
   recorded in batches with case/row IDs; no missing score is inferred automatically.
3. Import the edited packet with the command below. Partial review remains partial.
   One reviewer must not be described as inter-rater agreement. Mock review can rehearse
   scoring but cannot substitute for future live-output human review.

```bash
npm run agent:review:prepare
npm run agent:review:render -- f5847f03-1b7d-4103-84c3-d9f79cfe55d6
npm run agent:review:score -- f5847f03-1b7d-4103-84c3-d9f79cfe55d6
```

Calibration JSON is preserved if already present so preparing again does not erase
human edits. Readable packets were generated locally for this run. All raw packets
remain ignored/uncommitted; the source synthetic corpus was already committed in A0.

## Reproduction and checks

Seed the explicit isolated A0 fixture database using its runbook, then:

```bash
npm run agent:eval:mock
npm run check
npm run agent:check
npm run agent:mcp:test
npm run test:integration
```

No real keys are needed. No business records are written by the mock comparison;
SQL operates on frozen VALUES and MCP reads only the explicit snapshot database.
The development sentinel is read only during fixture setup/verification/cleanup.

This stage adds review/metric tests plus a Python guard proving live mode is refused
before MCP/provider access. Existing fixture-scope compatibility and business safety
checks were rerun. Exact final check counts are recorded in docs/17. No application
UI changed; browser tests were not rerun. No Git commit or push was made.


Final local verification: npm run check passed (lint, typecheck, **174 offline tests /
35 files**, production build); agent:check passed (**29 Python tests**, **31 shared
contract cases**). The **107 database integration tests / 21 files** passed with
unchanged isolation sentinel. Default-family MCP compatibility passed. Review import
accepted **0/160** human ratings and left all human/quality gates incomplete. Initial
service-readiness and sandbox-build failures were resolved on healthy/permitted retries.
No private database writes, real model calls, external trace export or Git commit/push.
