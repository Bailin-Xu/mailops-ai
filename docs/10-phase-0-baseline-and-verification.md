# MailOps AI — Phase 0 Baseline and Verification

Date: **2026-10-27**. Scope: tasks P0-T1 through P0-T5 in the
[implementation plan](09-code-inventory-and-career-implementation-plan.md).

## 1. Requirements Reconciliation

Phase 0 changes test infrastructure, demo preparation, and documentation. The
classification, knowledge-approval, draft-generation, and simulated-send business
rules are unchanged.

| Topic | Current contract | Deferred work |
| --- | --- | --- |
| Classification | AIR-013: confidence >= 0.70 routes automatically except MANUAL_REVIEW; AUTO_ROUTED is not approval. Original output and corrections remain separate | The provider's requiresHumanReview field is schema-validated, but routing currently derives its gate from confidence/category. Resolve any proposed policy change explicitly in Phase 1 |
| Draft states | GENERATED, SUPERSEDED, SIMULATED_SENT. Failure is recorded on execution/processing records; final human text is stored separately | FR-076's independently saved edits, approvals, and rejections are targets for Phases 1/4; FR-080's combined confirmation/simulation is current behavior |
| Grounding | One qualifying ACTIVE entry, deterministic relevance gate, cited-source membership validation, no-knowledge fallback | Immutable evidence is Phase 2; factual support scoring and experiment comparisons are Phase 3 |
| Provider methods | classifyEmail and generateDraft; Gemini and deterministic Mock implementations | Translation, AI candidate extraction, tools, and multi-agent orchestration are not implemented merely because a design sketch mentions them |
| Threads | Imported messages get individual threads; the planner computes grouping without applying it | Transactional reconstruction application and relationship integrity are Phase 5 |
| Integration foundations | Dispatch/ticket services and simulated adapters exist; Inbox uses its simpler simulation path | No real synchronization, email delivery, Discord, or production worker has been added |

The requirements file is `01-mvp-requirements-refactored.md`; AGENTS.md now points
to that existing file. FR-076 and the provider interface sketch explicitly label
the difference between current behavior and future targets. No requirement is
silently considered complete by this reconciliation.

## 2. Clean Local Setup

Prerequisites: Node.js 20.9 or newer supported by the installed Next.js release
(CI uses Node.js 22), npm, and Docker Compose. From the repository root:

```bash
cp .env.example .env
npm ci
docker compose up -d --wait postgres
npm run db:validate
npm run db:deploy
npm run demo:seed
npm run demo:seed
```

On an empty database, the seed reports 4 imported messages on its first run and 4
duplicates on its second. Exactly two candidate/knowledge pairs are created with
one synthetic approval event each. No provider is invoked, and later reviewer
changes are not overwritten by reseeding. `db:deploy` applies existing migrations;
use `db:migrate` only when developing an intentional schema change.

Run `npm run dev` with `AI_PROVIDER=mock`, open `/inbox`, and explicitly trigger each
demo email. Expected behavior with the current Mock provider:

| Demo message | Expected result |
| --- | --- |
| Tracked shipping delivery (English) | DRAFT_READY; English reply containing the approved synthetic shipping answer |
| Livraison avec suivi (French) | DRAFT_READY; French reply preserving accented characters |
| Upload error (English) | TECHNICAL_QUEUED; no reply draft |
| Précision nécessaire (French) | WAITING_FOR_REVIEW; no reply draft |

Both shipping drafts remain GENERATED until a human explicitly confirms a
simulated send. Demo facts are authored, pre-approved fixtures, not real company
policy or AI-approved knowledge. The existing provider still uses a fixed sample
reply signature/style; making that configurable remains IMP-08, not Phase 0 work.

### Seed and reset boundaries

- `demo:seed` inserts known fixture identifiers and does not classify, send,
  truncate, delete, or overwrite reviewer changes. It targets the explicitly
  configured application database, so invoke it only where demo records are wanted.
- Fixture emails live under `tests/fixtures/eml/neutral-demo/`; knowledge fixtures
  and stable candidate fingerprints live in `scripts/demo/seed.ts`.
- Re-running the seed does not reset edited/rejected knowledge or processed mail.
  A genuinely fresh demo should use a separate disposable local checkout/database
  or a deliberately backed-up empty development database. No broad reset command
  is provided for a database that may contain private imported mail.
- The older `eml:demo:seed` and historical website catalogs remain available for
  their existing use cases; they are not required for this neutral baseline.

## 3. Offline and Integration Boundaries

| Command | Scope | Database/model behavior |
| --- | --- | --- |
| `npm test` | All non-integration tests under lib/tests | getDb is blocked; global external fetch is blocked; adapters inject mocks |
| `npm run check` | Lint, type checking, offline tests, production build | Mock configuration; no Gemini key required |
| `npm run test:integration` | All integration files discovered under lib/tests, including dispatch/tickets and new baseline tests | Dedicated test DB only; applies migrations and checks a separate sentinel; live fetch is blocked |
| `npm run ai:gemini:smoke` / `ai:eval:*` | Explicitly invoked model experiments | Not part of offline tests, integration tests, or CI; may call the configured provider and persist results |

Do not interpret Mock correctness tests as measured model quality. Evaluation run
versioning, metric quality, and failure gates are still Phase 3 tasks.

### Dedicated test database

```bash
docker compose --profile test up -d --wait postgres-test
```

Copy the `TEST_DATABASE_URL` example into the ignored local `.env`, or set it for
the command explicitly. It points to loopback port 5434, database `mailops_test`,
and role `mailops_test`. Development remains on port 5433/database `mailops`.

Before any connection or migration, the runner requires the explicit test URL,
checks protocol/host/database/role/password, allows only the public schema query
parameter, and rejects the same physical database as DATABASE_URL even when URL
credentials, loopback spelling, or schema differ. Remote hosts and connection
override parameters are rejected. Direct use of the integration Vitest config
also performs validation before test modules load.

The runner creates a separate **synthetic control database** named
`mailops_dev_sentinel` inside the disposable test PostgreSQL instance. It inserts
a random marker before migrations/tests, verifies the marker afterward, and
removes that marker. This represents a separate development database for the
isolation acceptance test; it does not connect to or modify the user's real
development database. The local and CI test roles need CREATEDB permission;
these credentials are exclusively for disposable local/CI services.

The test container has no persistent data volume. Stopping/recreating this test
service discards its test/control databases, and the next integration run reapplies
the migrations. Never run a project-wide volume deletion to reset tests.

## 4. Continuous Integration

`.github/workflows/check.yml` defines a single job for pushes and pull requests:

1. Check out the repository and install Node.js 22.
2. Start a fresh PostgreSQL 17 test service and run `npm ci`.
3. Run `npm run check` with Mock AI and external delivery disabled.
4. Run the complete `npm run test:integration` command with an explicit test URL.

No provider API key or private data is used. Workflow configuration can be checked
locally, but an actual GitHub Actions result requires a later authorized push.

## 5. Verification Evidence

Execution results and phase acceptance mappings are recorded in the Phase 0 closure
entry of the [implementation plan](09-code-inventory-and-career-implementation-plan.md).
The integration tests specifically cover seed idempotency, preservation of later
knowledge edits, both response languages, technical/manual fallbacks, and refusal
of missing/unsafe test targets before migration. The runner checks the separate
control-database marker even when a migration or test fails.
