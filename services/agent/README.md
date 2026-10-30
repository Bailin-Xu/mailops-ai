# Python Agent service — A0–A2

A2 adds the nonpersistent FastAPI/LangGraph execution service over A1 MCP tools.
Default model is mock. See [the A2 runbook](../../docs/agent/a2-bounded-workflow-and-tracing.md)
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
No model key is needed for normal checks. A3 durability and business commits remain deferred.
