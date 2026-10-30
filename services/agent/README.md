# Python Agent service — A0–A3

A3 adds durable PostgreSQL execution, human continuation and safe TS business submission.
Default model is mock. See [the A2 runbook](../../docs/agent/a3-persistence-and-safe-commit.md)
for startup, credentials, explicit live/export configuration, budgets and limits.

```bash
python3.12 -m venv services/agent/.venv
services/agent/.venv/bin/pip install -r services/agent/requirements.lock
services/agent/.venv/bin/pip check
npm run agent:check
```

Python 3.12.14 was used locally. requirements.in pins direct dependencies;
requirements.lock includes transitive versions. `npm run agent:workflow:test` needs
the explicit isolated fixture database and tests the real MCP roundtrip with mock AI.
No model key is needed for normal checks. Production startup requires explicit isolated checkpoint and authenticated TS bridge
configuration. Initialize checkpoint schemas with npm run agent:checkpoint:setup.
The real subprocess recovery suite is npm run agent:durable:test.
