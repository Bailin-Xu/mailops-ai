"""Real protocol integration; launched with temporary run capabilities by TS runner."""

import asyncio
import json
import os
from typing import Any, cast
from mcp_client import connect, call_tool, SourceResult


async def main():
    url, secret = os.environ["A1_MCP_URL"], os.environ["A1_CAPABILITY"]
    run, thread = os.environ["A1_RUN_ID"], os.environ["A1_THREAD_ID"]
    for _attempt in range(2):  # new HTTP/client session: reconnect retains run scope
        async with connect(url, secret) as session:
            listed = await session.list_tools()
            assert {t.name for t in listed.tools} == {
                "get_thread_context",
                "search_approved_knowledge",
                "get_knowledge_revision",
            }
            for t in listed.tools:
                assert t.output_schema and t.annotations.read_only_hint
            context = await call_tool(session, "get_thread_context", {"runId": run, "reference": thread})
            assert not context.is_error and context.structured_content["threadId"] == thread
            assert context.structured_content["trust"] == "UNTRUSTED_TEXT"
            found = await call_tool(
                session, "search_approved_knowledge", {"runId": run, "query": "policy", "language": "fr", "limit": 8}
            )
            assert not found.is_error and found.structured_content["sources"]
            source = found.structured_content["sources"][0]
            for corrupt in [
                {**source, "answer": "x" * 12001},
                {**source, "trust": "TRUSTED"},
                {**source, "secret": "unexpected"},
            ]:
                try:
                    SourceResult.model_validate(corrupt)
                except ValueError:
                    pass
                else:
                    raise AssertionError("Invalid MCP output accepted")
            revision = await call_tool(
                session, "get_knowledge_revision", {"runId": run, "reference": source["revisionId"]}
            )
            assert not revision.is_error and revision.structured_content == source
            for tool, args in [
                ("get_thread_context", {"runId": "00000000-0000-4000-8000-000000000000", "reference": thread}),
                ("get_thread_context", {"runId": run, "reference": "00000000-0000-4000-8000-000000000000"}),
                ("get_knowledge_revision", {"runId": run, "reference": thread}),
                ("search_approved_knowledge", {"runId": run, "query": "policy", "language": "fr", "limit": 9}),
                ("send_email", {}),
            ]:
                result = await call_tool(session, tool, cast(dict[str, Any], args))
                assert result.is_error
    # Verify credentials and Origin rejected at HTTP boundary, not model policy.
    import httpx2

    async with httpx2.AsyncClient(trust_env=False) as http:
        assert (await http.post(url, json={})).status_code == 401
        assert (await http.post(url, headers={"Authorization": "Bearer wrong"}, json={})).status_code == 401
        assert (
            await http.post(url, headers={"Authorization": f"Bearer {secret}"}, content="x" * 32769)
        ).status_code == 413
        assert (
            await http.post(url, headers={"Authorization": f"Bearer {secret}", "Host": "evil.invalid"}, json={})
        ).status_code == 403
        assert (
            await http.post(url, headers={"Authorization": f"Bearer {secret}"}, content="bad-json")
        ).status_code == 400
        assert (
            await http.post(
                url, headers={"Authorization": f"Bearer {secret}", "Origin": "https://example.invalid"}, json={}
            )
        ).status_code == 403
    print(json.dumps({"status": "passed", "sessions": 2, "protocol": "MCP Streamable HTTP"}))


if __name__ == "__main__":
    asyncio.run(main())
