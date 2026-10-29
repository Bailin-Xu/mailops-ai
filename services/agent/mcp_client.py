"""Read-only MCP client. Fixed loopback endpoint; credentials never reach tools."""
from contextlib import asynccontextmanager
from urllib.parse import urlparse
import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

@asynccontextmanager
async def connect(url: str, capability: str):
    parsed = urlparse(url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path != "/mcp" or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Only an explicit local MCP endpoint is allowed")
    async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {capability}"}, timeout=5, trust_env=False, follow_redirects=False) as http:
        async with streamable_http_client(url, http_client=http) as (read, write):
            async with ClientSession(read, write, read_timeout_seconds=5) as session:
                await session.initialize()
                yield session

from typing import Literal
from pydantic import Field
from contracts import Boundary, Id, Hash
class SourceResult(Boundary):
    entryId: Id
    revisionId: Id
    contentHash: Hash
    title: str = Field(max_length=500)
    answer: str = Field(max_length=12000)
    language: Literal["en", "fr"]
    trust: Literal["UNTRUSTED_TEXT"]
class ThreadResult(Boundary):
    threadId: Id
    contextHash: Hash
    subject: str = Field(max_length=500)
    body: str = Field(max_length=16000)
    language: Literal["en", "fr"]
    trust: Literal["UNTRUSTED_TEXT"]
class SearchResult(Boundary):
    sources: list[SourceResult] = Field(max_length=8)
async def call_tool(session, name: str, arguments: dict):
    result = await session.call_tool(name, arguments)
    if not result.is_error:
        models = {"get_thread_context": ThreadResult, "search_approved_knowledge": SearchResult, "get_knowledge_revision": SourceResult}
        models[name].model_validate(result.structured_content)
    return result
