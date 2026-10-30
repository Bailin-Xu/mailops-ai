# A1 — MCP tools and Python client

> Current runtime update: [A3 persistence and business integration](a3-persistence-and-safe-commit.md)
> supersedes the nonpersistent/synthetic-only runtime boundaries described historically below.


Date: 2026-10-29. Status: implemented; synthetic-only read tools.

## Delivered boundary

The TypeScript official MCP SDK 1.32.2 serves Streamable HTTP on loopback. The
Python MCP SDK 2.3.0 initializes a session, discovers tools, invokes them, validates
structured results with Pydantic and reconnects. These versions were tested together;
Python v2 yields two transport streams and uses snake_case result attributes.

Exactly three tools are exposed:

| Tool | Inputs | Structured result |
| --- | --- | --- |
| get_thread_context | runId, authorized thread reference | bounded subject/body, language, context hash, UNTRUSTED_TEXT marker |
| search_approved_knowledge | runId, query (2–500 chars), en/fr, limit (1–8) | bounded active source records with entry/revision IDs and content hash |
| get_knowledge_revision | runId, revision reference from this run's search | current eligible source record; inactive versions rejected |

Inputs/outputs use strict Zod schemas in services/mcp/tools.ts. Python result
schemas in services/agent/mcp_client.py reject incompatible structured output.
Thread body <=16,000 characters; knowledge answer <=12,000, title <=500; at most
8 sources. Oversized evidence fails rather than silently truncating factual claims.
Tool text is explicitly untrusted; no agent or prompt execution occurs in A1.

No write, approve, send, arbitrary network, filesystem or SQL tool is listed.
A random bearer capability is issued by the trusted launcher and bound server-side
to one run/thread and expiry. START/RESUME issuance through the application is A2/A3;
there is no public token-minting HTTP endpoint. Manual startup accepts trusted
launcher configuration, not model-authored credentials. Capabilities never appear
in tool arguments or logs. Host must match the loopback listener, browser Origins
are rejected, CORS is disabled, and requests are capped at 32 KiB. Non-POST methods
return 405 (no optional standalone SSE stream or persistent protocol session).

Each operation authorizes before reading and again after awaiting its repository.
Revision access requires a reference actually returned by this run's search.
Tool work times out at 2 seconds; database connections and statements are independently
bounded. Timeout aborts cooperative adapters and grants no late evidence references.
Arbitrary backend errors are converted to sanitized tool errors. Schema failures
are MCP tool errors; credentials/Host/Origin failures are HTTP rejection responses.

Run-scoped references live in memory, survive HTTP reconnects, expire with the
capability and disappear when the process restarts. Durable run recovery is A3,
not a guarantee of this read-only service. Cancellation is not implemented yet.

## Existing-system integration

services/mcp/snapshot-repository.ts reads only the explicit A0 snapshot database.
It scopes each run to the selected synthetic family and materializes versioned
knowledge as a parameterized SQL VALUES relation, just like the existing evaluation
adapter. It reuses snapshotRetriever -> buildKnowledgeSearchQuery (the same English/
French ACTIVE-only PostgreSQL full-text query used by application search), and
sourceContextHash for thread context. No independent lexical search implementation
or business-table write is introduced. Revision IDs and content hashes are included
in every source response and eligibility is reread on lookup.

The selected synthetic case is adapted to a one-message context; its synthetic
knowledge ID is used as the fixture thread UUID. It is not an application EmailThread
or an approved business-table KnowledgeRevision. This is the isolated snapshot seam
anticipated in A0; no private development records or app knowledge tables are loaded.
A2/A3 must add a real application context/admission adapter and preserve canonical
thread/review revisions before business integration. A1 does not expose the Inbox
through MCP, create drafts, call models or authorize knowledge.

## Reproduce

Install Node dependencies using npm ci, and Python dependencies using the A0
services/agent/requirements.lock. Start/seed the disposable snapshot per
[a0 fixture instructions](a0-fixtures-and-verification.md), then:

```bash
export AGENT_FIXTURE_DATABASE_URL=postgresql://mailops_agent_a0:mailops_agent_a0_local@127.0.0.1:5435/mailops_agent_a0
npm run agent:mcp:test
```

This test launcher chooses an ephemeral port, random run ID and capability, starts
the actual HTTP server and invokes the Python integration script. It closes the
listener/database afterwards. It needs no model keys, external network or trace service.

For a standalone synthetic listener, configure MCP_CASE_ID (for example
`tuning-delivery-00-fr`), MCP_RUN_ID (UUID), MCP_CAPABILITY (random secret >=32 chars),
and optionally MCP_PORT (default 8103). Run `npm run agent:mcp`. This launcher grants
five minutes of read access to one synthetic family; restart requires a new client
connection and trusted configuration. Never commit or print the capability.
The Python connect context manager accepts an explicit loopback /mcp URL and
capability; redirects/proxy environment are disabled. It does not select tools or
invoke an LLM. A2 supplies the actual Agent consumer.

## Acceptance evidence

- A1-T1/A1-A1: official SDK server/client, real initialization, discovery of exactly
  three tools and validated thread/search/revision round trips; two client sessions.
- A1-T2: shared PostgreSQL query and context hashing, scoped frozen snapshot seam.
- A1-T3: Python client reconnect, tool failures and HTTP rejection cases passed.
- A1-T4/A1-A2: unit tests cover pre-read scope denial, French/adversarial text,
  reference allowlist, retired-after-search evidence, output limits, timeout/abort,
  expiry and malformed inputs. Real protocol tests cover invalid credentials,
  run/thread references, unknown tools, invalid limits, Host/Origin, oversized body
  and invalid JSON. No dangerous tool is exposed.
- A1-A3: final quality checks and regression counts recorded in docs/17 closure below.

Remaining limits: one trusted synthetic grant per process, no persistent capability
store, no application admission/approval bridge, no LangGraph or live evaluation.
The UNTRUSTED_TEXT marker preserves the boundary but does not prove resistance of
an eventual model to every injection; that is A2/A4 work.

References: [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[official Python SDK](https://github.com/modelcontextprotocol/python-sdk).
