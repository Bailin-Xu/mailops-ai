# MailOps AI

MailOps AI is a local, human-in-the-loop email operations MVP. It imports `.eml`
messages, classifies English and French inquiries, retrieves only human-approved
knowledge, creates grounded reply drafts, and simulates sending.

The project is intentionally provider-agnostic. The MVP uses synthetic email data,
a deterministic mock AI provider for development and tests, and an optional Gemini
provider behind an internal interface.

## Prerequisites

- Node.js 20 or newer
- Docker Desktop with Docker Compose

## Local setup

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:validate
npm run db:deploy
npm run demo:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The database health endpoint is
available at [http://localhost:3000/api/health](http://localhost:3000/api/health).

The database also contains classification, approved-knowledge, draft, durable
reply-dispatch, bug-ticket, safety-control, and audit records. Attachment content
is deliberately excluded from the data model; only safe metadata is persisted.

## Common commands

```bash
npm run lint          # ESLint
npm run typecheck     # TypeScript strict-mode check
npm run test          # Offline tests only; no database or external service calls
npm run test:integration # Migrate the explicit test DB and run every integration test
npm run demo:seed     # Neutral EN/FR demo mail plus pre-approved synthetic knowledge; no AI calls
npm run eml:scan      # Aggregate-only scan of private local EML files
npm run eml:import    # Import a private local EML directory and auto-process inbound mail with Mock AI
npm run eml:demo:seed # Import three synthetic known-question emails without calling AI
npm run eml:threads:plan # Dry-run thread reconstruction
npm run ai:gemini:smoke # Two synthetic Gemini calls; never uses stored email
npm run ai:eval:synthetic # Run the 12-message synthetic Shadow Mode acceptance set
npm run ai:eval:holdout # Run or resume the frozen 8-message holdout without repeating calls
npm run build         # Production build
npm run check         # Lint, types, offline tests, build; run integration separately
npm run db:generate   # Regenerate Prisma Client
npm run db:migrate    # Create/apply a development migration
npm run db:deploy     # Apply existing migrations (fresh setup and CI)
npm run db:studio     # Inspect local data
docker compose down   # Stop PostgreSQL without deleting its volume
```

Gemini is optional. Keep `AI_PROVIDER="mock"` for deterministic offline work. To
test Gemini in Shadow Mode, store `GEMINI_API_KEY` only in the ignored local
`.env`, set `GEMINI_MODEL="gemini-3.5-flash-lite"`, then change
`AI_PROVIDER="gemini"` and restart the development server. The provider sends
only the subject and cleaned inbound body for classification, or that same input
plus one selected Active Knowledge entry for draft generation. It never sends
attachments and never performs delivery. Free-tier Gemini must be limited to
synthetic or safely redacted messages.

The container publishes PostgreSQL on host port `5433` to avoid clashing with a
PostgreSQL installation that may already be using the conventional port `5432`.

## Reproducible demo and isolated tests

`npm run demo:seed` adds four neutral synthetic emails (English/French tracked
shipping questions, an upload issue, and an ambiguous inquiry) and two matching
pre-approved synthetic knowledge records. It never calls AI and preserves later
reviewer edits when rerun. Run each email manually in Inbox with `AI_PROVIDER=mock`.
See the [Phase 0 baseline guide](docs/10-phase-0-baseline-and-verification.md) for
expected routes, reset boundaries, requirement reconciliation, and test evidence.

Start the separate, disposable PostgreSQL service before integration checks:

```bash
docker compose --profile test up -d --wait postgres-test
```

Set `TEST_DATABASE_URL` using the dedicated local URL in `.env.example` (copy this
line into an existing ignored `.env`, or export it in your shell), then run:

```bash
npm run test:integration
npm run check
```

Integration checks require a loopback database and role both named `mailops_test`,
reject the development database as a target, apply existing migrations, and verify
an unchanged marker in a separate synthetic sentinel database. They never fall
back to `DATABASE_URL`. The dedicated local test role needs `CREATEDB` permission
for this marker database; the supplied disposable container provides it. Both test
setups disable live model calls; adapter tests inject their own mocked responses.

The test container uses temporary storage. Stop it with
`docker compose --profile test stop postgres-test`; stopping discards its data.
Restart it and rerun `npm run test:integration` to recreate the schema. This does
not stop or reset the development `postgres` service or its persistent volume.

CI runs the same offline/build and complete integration commands against a fresh
PostgreSQL service. Live-model smoke/evaluation commands remain explicit opt-in
commands; they are excluded from automated checks and require synthetic/redacted
inputs. No Gemini key is needed for normal checks.

## Local EML validation

Place private email files in `data/raw/all-eml/`. The entire `data/raw/` directory is
ignored by Git and must never be committed. Run:

```bash
npm run eml:scan
```

The scanner enforces the 10 MiB MVP limit and prints aggregate counts only. It does
not print filenames, addresses, subjects, bodies, or attachment content. Automated
tests use synthetic fixtures under `tests/fixtures/eml/`.

To add three safe, unclassified inbound messages that exactly correspond to
approved demo knowledge, run `npm run eml:demo:seed`. The command is idempotent
and does not call an AI provider; open Inbox and trigger each test manually.

The reusable `ingestEml()` service imports one buffer at a time. It parses and
validates the message, checks `Message-ID` and fingerprint duplicates, then writes a
single-message thread and its complete message graph in one database transaction.

To import a directory through that service, run:

```bash
npm run eml:import -- data/raw/all-eml
```

The command prints aggregate import, duplicate, failure, and database record counts
only. It is safe to rerun: existing messages are reported as duplicates instead of
being inserted again.

Thread reconstruction can be inspected without changing the database:

```bash
npm run eml:threads:plan
```

The planner uses only `Message-ID`, `In-Reply-To`, and `References`. It prints
aggregate counts only and deliberately does not use subject-based fallback matching.

## MVP learning path

1. Foundation: local PostgreSQL, Prisma, configuration validation, quality checks.
2. Intake: `.eml` validation, parsing, normalization, duplicate detection.
3. Inbox: persistence, thread reconstruction, search, and review UI.
4. AI boundary: structured schemas, mock provider, Gemini provider, execution logs.
5. Human review: classification correction and knowledge approval workflows.
6. Grounded generation: keyword/full-text retrieval, cited drafts, simulated send.

Vector embeddings are deliberately deferred until the keyword/PostgreSQL retrieval
baseline works and can be evaluated. This makes later RAG improvements measurable.

## Implementation plan

The [code inventory and career implementation plan](docs/09-code-inventory-and-career-implementation-plan.md)
records implemented capabilities, incomplete workflows, and planned additions for
AI application, full-stack, and backend portfolio directions. It defines tasks,
dependencies, and acceptance criteria for six phases: complete the shared baseline,
state correctness, and knowledge-version work first, then select a specialization.
Phases 0–5 are complete. The [state consistency guide](docs/11-phase-1-state-consistency-and-verification.md)
documents stale-draft protection, safe replacement, review revision conflicts, and
legacy-data behavior. Apply existing migrations with `npm run db:deploy` before
using an updated checkout. The [knowledge/evidence guide](docs/12-phase-2-knowledge-evidence-and-verification.md)
documents immutable approved versions, captured generation inputs, pending-draft
impact detection, history queries, and legacy migration behavior. Old pending drafts
need regeneration; classifications without valid context need a new attempt first.
The [AI evaluation guide](docs/13-phase-3-ai-evaluation.md) documents frozen bilingual
datasets, independent run manifests, safe resumption, metric denominators and paired
mock scorecards. Run `npm run ai:eval -- --split tuning --retrieval baseline-v1`
with the isolated `TEST_DATABASE_URL`; the default is mock even if `.env` selects
Gemini. Live calls require explicit `--live`. Quality failures return exit 1; execution
failures return exit 2. The synthetic/holdout commands now alias this isolated runner
instead of importing into the Inbox. Recorded mock weaknesses remain visible.
The [full-stack review guide](docs/14-phase-4-full-stack-review.md) documents version
comparison, affected replies, conflict-preserving review, paginated lists, independent
human draft saves/rejection and a reproducible browser demonstration. Apply migrations
and restart an existing development server before using the new draft review fields.
For isolated browser checks, install Chromium with `npx playwright install chromium`,
start the test database, then run `npm run test:e2e` with `TEST_DATABASE_URL`.
The [thread reconstruction guide](docs/15-phase-5-thread-reconstruction-and-scale.md)
and [performance report](docs/16-phase-5-performance-report.md) document validated
plan/apply, historical origins/aliases, stale-work safeguards and measured 1k/10k/50k
synthetic scale limits. `npm run eml:threads:reconstruct` prepares a private local plan;
applying it requires an explicit `--apply` argument and a maintenance window.
`npm run bench:threads` is an opt-in synthetic benchmark requiring the isolated
`TEST_DATABASE_URL` and scratch-database permission. No reconstruction of existing
private/development messages was performed. All six portfolio phases are complete;
future integrations remain separately scoped.
Future integration designs do not represent completed functionality.

The future Gmail, Discord, Artur-reference, delayed-send, concurrency, and privacy
architecture is documented in
[`docs/06-production-integration-foundation.md`](docs/06-production-integration-foundation.md).

## Safety boundaries

- Use only synthetic or safely redacted `.eml` fixtures.
- Never commit `.env`, API keys, or real private email content.
- Never process attachment bodies or load remote images in the MVP.
- AI output remains untrusted until a human reviews it.
- Sending is simulated; no real mailbox provider is connected.
- `SHADOW_MODE=true` and `EXTERNAL_DELIVERY_ENABLED=false` are the safe defaults;
  the database global kill switch independently defaults to the same state.

## Experimental mock Agent review

The opt-in Python/LangGraph + MCP review UI runs only against the isolated
synthetic test database. See [A5 setup and review runbook](docs/agent/a5-mock-review-ui.md)
for `npm run agent:ui:mock` (http://127.0.0.1:3115/inbox), pause/resume/cancel,
immutable evidence and reproducible checks. The normal development app keeps
Agent mode disabled. A4 real-model evaluation and human scoring remain pending.
