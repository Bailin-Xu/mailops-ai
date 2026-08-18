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
npm run db:migrate -- --name init
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
npm run test          # Vitest test suite
npm run eml:scan      # Aggregate-only scan of private local EML files
npm run eml:import    # Import a private local EML directory and auto-process inbound mail with Mock AI
npm run eml:demo:seed # Import three synthetic known-question emails without calling AI
npm run eml:threads:plan # Dry-run thread reconstruction
npm run ai:gemini:smoke # Two synthetic Gemini calls; never uses stored email
npm run ai:eval:synthetic # Run the 12-message synthetic Shadow Mode acceptance set
npm run ai:eval:holdout # Run or resume the frozen 8-message holdout without repeating calls
npm run build         # Production build
npm run check         # All required quality checks
npm run db:generate   # Regenerate Prisma Client
npm run db:migrate    # Create/apply a development migration
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
