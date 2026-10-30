# Phase 4 — Full-Stack Knowledge Revision Review

Completed: **2026-10-28**. All P4-T1–T5 tasks and P4-A1–A5 acceptance criteria
are implemented and checked locally. No Git commit or push is part of this task.

## Reviewer workflow

Knowledge review is available at `/knowledge/<entry UUID>`, linked from candidate
records, knowledge-search results, and a reply's immutable grounding evidence.
The page provides:

- bounded version history, approval origin/time and reviewer notes;
- field-by-field comparison of a selected saved revision with current knowledge,
  including textual changed labels as well as highlighting;
- affected pending replies, captured version numbers, reasons and Inbox links;
- explicit knowledge re-review, activation, rejection, deactivation and archival;
- original candidate/source links, separate from human-reviewed text.

The comparison version is scoped to the selected entry. An unrelated or missing
revision cannot be used as that entry's evidence. `page`, `compare` and affected
reply `impact` cursor values are carried in URL state. Version history has 10 rows
per page; affected replies have 10 rows per cursor page. The latter is a changing
work queue: regenerate/reject removes an item, and first-page navigation is always
available. Confirmed history is unchanged by knowledge edits or retirement.

### Proposed text and revision conflicts

Knowledge editors keep controlled input separate from new server props. Every
submission includes the candidate revision the proposal was based on. A rejected
request (including validation errors) keeps the proposal instead of resetting it.
A two-tab conflict offers three explicit steps:

1. **Compare with latest saved version** loads current server props without
   replacing the local proposal or silently adopting its revision token.
2. Inspect latest text versus proposed text, with changed fields identified.
3. Explicitly keep the proposal against the latest revision, or replace it with
   the latest saved text; then submit a deliberate review decision.

Successful knowledge approval publishes an immutable version and flags affected
pending replies through Phase 2 services. Rejection deactivates its knowledge;
re-approval explicitly publishes a new version. Deactivation/archival invalidates
older candidate editor tokens as well. Active knowledge and candidate approval are
shown separately: an approved candidate can have retired knowledge.

Unsaved proposals survive failed submissions and in-place latest-version loading.
They are not autosaved across closing a tab, hard reload or selecting another
record. Save a draft's human edits explicitly if they must survive reload.

## Minimal draft review lifecycle (FR-076 / FR-080)

Phase 4 closes the previously documented independent-save/reject gap without
introducing a separate approval-to-delivery queue:

| Visible state | Persistence and allowed actions |
| --- | --- |
| Generated | Original AI text/evidence stays immutable; save human edits, reject, regenerate, or explicitly confirm a simulated send |
| Edited | `GENERATED` with `editedAt` and separate `editedSubject`, `editedBody`, `editedLanguage`; no approval or sending occurred |
| Rejected | Persisted `REJECTED`, timestamp and optional note; confirmation is blocked; classification `DRAFT_REJECTED` permits regeneration |
| Superseded | Successful replacement preserves the older row, original output, human edits and source evidence |
| Simulated sent | Explicit human confirmation stores final approved text/language and timestamp; no external delivery |
| Generation failure | Failed AI execution/processing status; a still-valid previous reply and its saved human edits are retained |

This explicitly reconciles the target state names in FR-076 with FR-080's combined
approval/simulated-send operation. `EDITED` is a saved substate, not another enum;
`GENERATION_FAILED` is execution metadata, not a fabricated draft. A standalone
persisted `APPROVED` queue remains outside this minimal lifecycle.

The `reviewRevision` token protects saving, rejecting and final confirmation from
competing tabs. Saved text survives refresh and stays distinct from the provider's
`subject`/`body`/`language`. Confirmation still checks current classification,
inbound context, immutable evidence and active current knowledge. Stale knowledge
cannot become confirmable just because a human edit was saved. A current outdated
reply can be explicitly rejected without treating old evidence as trusted.

The initial classification context and existing draft review token are captured
in one serializable transaction before regeneration. A later human save changes
that token; the in-flight AI result is discarded instead of overwriting it. A
successful intentionally requested replacement keeps prior human edits in its old
row; unsaved browser text is not transferred to the new AI draft.

For untouched drafts, omitted review tokens in existing internal service callers
mean revision 0. Once any review has been saved, an omitted/old token fails rather
than overwriting newer text. All current browser forms submit explicit tokens.

## Lists, URL state and loading

- Inbox lists use database-side search/status filtering and stable creation-time/
  UUID ordering. A page contains at most 10 summaries with a 240-character preview,
  sender/date and workflow state. A lateral lookup selects latest classification
  metadata; list rows never fetch every thread's message/classification history.
- Only the selected inbound thread loads its timeline and detailed latest
  classification/draft. Its complete timeline is preserved; very long selected
  timelines are not yet paginated (a separate scale concern).
- Candidate lists contain at most 10 summaries, omit proposed answer bodies and
  source excerpts, and load only the selected candidate's editor/source details.
- Pagination preserves filters and explicit selection. Filter changes reset the
  page; out-of-range/deleted pages clamp to a valid page. Explicit selection is
  fetched independently of the list page/filter and is labeled when outside it.
  An unavailable explicit ID does not silently substitute another record.
- Loading, empty, successful, conflict and recoverable error states are supplied.
  Error boundaries expose a generic retry action without database paths/stacks.
  The detail pages do not trigger AI during rendering, navigation or refresh.
- English controls, keyboard-visible focus, native form/details controls and
  responsive comparison columns preserve readable French source and reply text.
  Email HTML is not rendered and remote tracking images are not loaded.

Pagination bounds response payloads; count/search queries still examine matching
records, and offset pagination is not a measured large-corpus optimization. No
latency/scale claim is made. Backend reconstruction/scale remains Phase 5.

## Schema and local setup

Migration: `20261028153000_add_draft_review` adds only draft review fields and the
`REJECTED` / `DRAFT_REJECTED` enum values. Existing drafts start at review revision
0 with no saved edits/rejection. It does not rewrite historical approved text or
immutable evidence. Migration tests upgrade real older-schema fixture rows and
verify preservation through both Phase 2 and Phase 4 changes.

```bash
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

The migration was also applied to the guarded local development target
`localhost:5433/mailops`; no mailbox/model calls or private-data backfills ran.
Restart an already-running development process after generating the new Prisma
client. Another checkout should apply migrations before opening the new UI.
Do not downgrade writers that do not understand saved/rejected review state.

## Browser verification

```bash
npx playwright install chromium
docker compose --profile test up -d --wait postgres-test
# Export the explicit TEST_DATABASE_URL from .env.example, then:
npm run test:e2e
```

The runner validates the same isolated loopback `mailops_test` database/role guard
as integration tests, applies migrations, and starts a separate mock-only server
on `127.0.0.1:3114`. It refuses an already-running server on that port. Application
build artifacts use `.next-e2e`, keeping the normal `.next` development/build
cache separate. TypeScript and ESLint know this generated cache boundary.

Synthetic fixtures use a private local IPC child process so Playwright's module
transform does not reinterpret Prisma's generated TypeScript. No fixture HTTP
endpoint, test-auth bypass or arbitrary SQL browser endpoint is added. Cleanup
removes only that test's synthetic records. Normal shutdown stops the owned server;
a hard crash may require stopping that local process/restarting the disposable DB.
Do not run database-mutating integration and browser suites concurrently.

`MAILOPS_E2E_FAULTS=true` is set only in the test server. Provider construction
rejects that flag unless AI is mock and the database target is the local test role/
DB. A marked synthetic body then fails draft generation, while normal application
configuration and normal mock calls are unaffected. There are no live Gemini calls.

Screenshots, traces and browser results are ignored local files in `test-results/`;
the verification data is synthetic. CI configuration now installs Chromium and
runs this same command after unit/build and integration checks; remote CI was not
executed in this local task.

### Six passing browser scenarios

1. French email → generated reply → knowledge correction → version diff → affected
   reply → regenerate → edit final French response → confirmed simulated send.
   Includes refresh-without-execution and no remote tracking-image requests.
2. Validation failure preserves input; two tabs conflict explicitly; compare/rebase
   then review succeeds; rejection and re-approval preserve version history.
3. Mock provider failure preserves the previous valid reply and permits human
   confirmation without another provider call.
4. More than one page of candidates and Inbox threads; keyboard activation,
   selection, reload, browser back, empty filters and 390-pixel review layout.
5. Save human edits independently and reload them; stale final confirmation fails
   without losing the other proposal; inspect latest saved reply, reject and
   regenerate a new reviewable reply before simulated confirmation.
6. Deactivate knowledge, inspect the affected reply, reject its outdated evidence,
   then resume safely into no-knowledge human handling.

Desktop comparison, mobile review and saved-draft screenshots were visually
inspected; mobile overflow and missing inherited button colors were fixed.
Chromium desktop/mobile viewport checks are not a full assistive-technology or
cross-browser accessibility audit.

## Short reproducible product demonstration

Use only local synthetic data. `npm run demo:seed` supplies idempotent bilingual
sample emails and approved fixture knowledge without model calls.

1. In Inbox, select a synthetic shipping message and run automatic processing with
   Mock AI. Open **Review knowledge history** from its grounding source.
2. Change the approved answer, inspect **Compare saved text with my proposal**, then
   **Approve & activate**. Compare the old immutable version with the current one.
3. Open the affected reply. Its old evidence stays visible and confirmation is
   blocked. **Regenerate reference reply** and inspect the new source/version.
4. Edit the final reply and **Save human edits**. Refresh to verify separate saved
   text. Reject and regenerate if unsuitable, or explicitly confirm simulated send.
5. In two tabs, repeat a competing edit to demonstrate conflict preservation and
   deliberate comparison/re-review. No actual email is sent.

## Checks and acceptance evidence

- `npm run db:generate` / `npm run db:validate`: passed.
- `npm run check`: lint, TypeScript, **30 files / 125 offline tests**, production build passed.
- `npm run test:integration`: **19 files / 82 tests passed**, including draft saves,
  concurrent reviews, in-flight regeneration, retirement, query payload bounds,
  page/selection rules, revision ownership and historical migration preservation.
  The separate isolation sentinel remained unchanged.
- `npm run test:e2e`: **6 browser scenarios passed** using Mock AI and isolated data.
- Prisma schema/migration diff: **no difference detected**.
- Local documentation links, whitespace and final Git diff reviewed; no real private
  fixtures, secrets or generated runtime files added.

P4-A1 is demonstrated by browser scenarios 1/6 and version/evidence tests; P4-A2 by
scenarios 2/5 and conditional review writes; P4-A3 by queue integration tests and
scenario 4; P4-A4 by scenarios 1–6; P4-A5 by scenario 1 and read-only queue tests.
Phase 5 and future enterprise integrations are not implemented here.

## CI follow-up — delayed hydration and failure evidence (2026-10-30)

The first GitHub run for `b2ff5c0` passed Python/Agent durability checks, 176
unit tests and 111 database tests, but failed the two-tab browser scenario at
`knowledge-review.spec.ts:54`: the expected minimum-answer-length alert did not
appear. That run did not upload its local trace or page context, so its exact
browser event sequence cannot be reconstructed retroactively.

A local diagnostic deliberately held Next.js client scripts, entered `short`
in the server-rendered review form, clicked approval and then released scripts.
Validation appeared, but the controlled answer field reverted to the original
saved answer. This deterministically exposed an early-interaction/input-loss
race; it is evidence of a concrete defect, not proof of the precise event order
in the earlier GitHub failure. Three ordinary local CI-mode runs had passed
before this diagnostic, so a passing repeat alone was insufficient.

`CandidateReviewForm` now uses distinct server/client readiness snapshots:
editable fields and approve/reject controls stay disabled while the server HTML
awaits React hydration. The form exposes its loading/busy state. Once interactive,
validation and revision conflicts continue preserving local proposals. This does
not change database authority, minimum-length validation or revision handling.

The existing two-tab test additionally verifies that React's proposed-text
comparison reflects the short answer before submitting it. A new second-tab
regression holds client scripts, checks disabled controls, releases scripts and
verifies short-answer rejection, input preservation and unchanged knowledge
version. It uses controlled request gates rather than sleeps, retries or a larger
timeout. Both scenarios passed three repetitions each after the change.

Playwright now captures screenshots only on failure, retains failed traces and
produces a non-opening HTML report. The `check` and `agent-durable` CI jobs upload
`test-results/` and `playwright-report/` under distinct `browser-failure-*`
artifact names when a preceding step fails, with seven-day retention. If failure
happens before a browser starts, missing files produce a warning instead of
inventing a report. Only isolated synthetic browser fixtures are used; environment
files, private messages and runtime databases are not uploaded.

A deliberately failing local pre-fix diagnostic produced a PNG, `error-context.md`
and `trace.zip`, verifying collection. Temporary pre-fix evidence was copied to
`/tmp/mailops-hydration-before.png` and `/tmp/mailops-hydration-before-trace.zip`;
these are local temporary files, not committed project artifacts. CI upload itself
requires a future push/run and has not been executed by this uncommitted task.

Local verification for this follow-up:

- `CI=true TEST_DATABASE_URL=<isolated test URL> npm run test:e2e -- knowledge-review.spec.ts --grep 'two tabs|delayed client' --repeat-each=3`: 6 passed.
- `CI=true TEST_DATABASE_URL=<isolated test URL> npm run test:e2e`: 8 passed;
  5 Agent-only tests intentionally skipped, matching the ordinary CI job.
- `CI=true MAILOPS_E2E_AGENT=true AGENT_CHECKPOINT_DATABASE_URL=<isolated checkpoint URL> TEST_DATABASE_URL=<isolated test URL> npm run test:e2e -- agent-review.spec.ts`: 5 passed.
- `npm run check`: lint, TypeScript, 176 unit tests / 37 files and production build passed.
- Ruby YAML parsing plus validation of both failure-upload configurations passed;
  this is not a remote GitHub execution of `upload-artifact`.
- `git diff --check`: passed. No new dependencies, database migrations, live model
  calls, Git commits, pushes or merges were performed. Test/checkpoint services
  were stopped after validation without deleting the checkpoint volume.

The earlier remote run remains failed until a future authorized push and CI run.
The missing historical trace cannot be recovered by changing the workflow now;
future failures will retain the evidence needed to distinguish any remaining
browser event sequence from the locally reproduced and fixed hydration race.
