# A0 fixtures and verification

Dedicated Docker profile agent-a0 uses loopback 5435, database/role mailops_agent_a0,
and tmpfs. It never mounts development volumes. The synthetic corpus is stored as
one JSONB snapshot in agent_a0_fixtures.snapshot. This is a fixture staging database,
not a populated application Inbox; A1/A2 adapters must materialize approved revisions
in an isolated business schema before runtime demos. No business schema migration
or private-message import is performed by A0.

Commands (local disposable credentials, never production):

```bash
docker compose --profile agent-a0 up -d postgres-agent-a0
export AGENT_FIXTURE_DATABASE_URL=postgresql://mailops_agent_a0:mailops_agent_a0_local@127.0.0.1:5435/mailops_agent_a0
export AGENT_SENTINEL_DATABASE_URL=postgresql://mailops:mailops_dev@127.0.0.1:5433/mailops
npm run agent:fixtures -- setup
npm run agent:fixtures -- verify
npm run agent:fixtures -- cleanup
docker compose --profile agent-a0 stop postgres-agent-a0
```

Each command validates its mutation target before any connection, verifies the
committed dataset fingerprint and uses a transaction. Setup is repeatable; cleanup
requires the known snapshot marker and matching content, drops only its table and
then its empty schema (no CASCADE). Wrong/missing target fails without fallback.
The explicit development sentinel connection is used only in READ ONLY transactions:
message count, candidate count and a hash of message rows are compared before/after;
no bodies, hashes or addresses are printed. Concurrent development edits may cause
a conservative verification failure; this check is not a backup or a full audit of
every table. Absence of development writes also follows from inspecting the script:
all mutations use the guarded dedicated connection.

Python: create services/agent/.venv with Python 3.12, install requirements.lock and
run npm run agent:contracts:python. TS: npm run check. Existing full application
regressions use npm run test:integration with its dedicated test service. No UI
changes in A0 require additional browser scenarios. No live model or external trace
export is needed for these checks.
