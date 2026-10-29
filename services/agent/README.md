# Python Agent foundation — A0 only

No HTTP server or Agent graph exists yet. `contracts.py` validates the same fixtures
as TypeScript. Tested Python: 3.12.14.

```bash
python3.12 -m venv services/agent/.venv
services/agent/.venv/bin/pip install -r services/agent/requirements.lock
services/agent/.venv/bin/pip check
npm run agent:contracts:python
```

requirements.in pins selected direct dependencies; requirements.lock records the
resolved environment including transitive versions. A1/A2 add services and runtime
SDK tests. Do not infer protocol compatibility from pip resolution alone.
See docs/agent/adr-001-runtime-and-contracts.md and docs/17 for ownership and scope.
