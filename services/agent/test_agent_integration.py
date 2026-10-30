"""Real HTTP MCP -> LangGraph -> FastAPI proposal roundtrip, no live models."""

import asyncio
import os
from fastapi.testclient import TestClient
from api import create_app
from contracts import Command
from mcp_client import connect, call_tool
from uuid import uuid4


async def context():
    async with connect(os.environ["A1_MCP_URL"], os.environ["A1_CAPABILITY"]) as session:
        result = await call_tool(
            session, "get_thread_context", {"runId": os.environ["A1_RUN_ID"], "reference": os.environ["A1_THREAD_ID"]}
        )
        return result.structured_content


def main():
    data = asyncio.run(context())
    run = os.environ["A1_RUN_ID"]
    command = Command.model_validate(
        {
            "contractVersion": "agent-v1",
            "action": "START",
            "runId": run,
            "commandId": str(uuid4()),
            "expectedRunRevision": 0,
            "fence": 1,
            "context": {
                "threadId": data["threadId"],
                "contextHash": data["contextHash"],
                "classificationRevision": 0,
                "draft": None,
            },
            "graphVersion": "agent-graph-v1",
            "policyVersion": "agent-policy-v1",
            "promptVersion": "agent-prompt-v1",
            "traceId": str(uuid4()),
        }
    )
    app = create_app("s" * 32, run, os.environ["A1_MCP_URL"], os.environ["A1_CAPABILITY"])
    with TestClient(app, base_url="http://127.0.0.1:8102", headers={"Authorization": "Bearer " + "s" * 32}) as client:
        response = client.post("/runs", json=command.model_dump())
        assert response.status_code == 200
        result = response.json()
        assert result["status"] == "WAITING_FOR_HUMAN", result["code"]
        assert result["proposal"]["outcome"] == "DRAFT"
        assert result["proposal"]["language"] == "fr"
        assert result["model_calls"] == 4 and result["tool_calls"] == 4
        assert client.get("/runs/" + run).json() == result
        assert client.post("/runs", json=command.model_dump()).status_code == 409
        assert all("body" not in event for event in result["events"])
    print("FastAPI/LangGraph/real MCP roundtrip passed; no business write or live model call")


if __name__ == "__main__":
    main()
