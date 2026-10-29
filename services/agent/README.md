# Python Agent foundation — A0/A1

The A1 MCP client connects to the TypeScript read-tools service; no Python HTTP server
or Agent graph exists yet. `contracts.py` validates the same fixtures
as TypeScript. Tested Python: 3.12.14.

```bash
python3.12 -m venv services/agent/.venv
services/agent/.venv/bin/pip install -r services/agent/requirements.lock
services/agent/.venv/bin/pip check
npm run agent:contracts:python
```

requirements.in pins selected direct dependencies; requirements.lock records the
resolved environment including transitive versions. A1 includes real SDK interoperability tests (`npm run agent:mcp:test`). A2 adds the
Agent execution service. See docs/agent/a1-mcp-tools-and-client.md for startup and scope.
See docs/agent/adr-001-runtime-and-contracts.md and docs/17 for ownership and scope.
