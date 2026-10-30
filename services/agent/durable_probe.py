"""Isolated process test driver; never used by production startup."""

import asyncio
import json
import os
import sys
from api import create_app, McpTools
from contracts import Command
from store import Store
from bridge import Bridge
from runtime import DurableRuntime
from models import MockModel
from fastapi.testclient import TestClient


class ProbeBridge(Bridge):
    async def call(self, op, data):
        if op == "COMMIT" and os.environ.get("A3_HOOK") == "rejectcommit":
            raise ConnectionError("Synthetic pre-submit connection failure")
        result = await super().call(op, data)
        if op == "COMMIT" and os.environ.get("A3_HOOK") == "commit":
            print("READY:commit", flush=True)
            await asyncio.sleep(60)
        return result


class ProbeModel(MockModel):
    async def invoke(self, task, payload):
        if task == "decide" and os.environ.get("A3_HOOK") == "checkpoint":
            print("READY:checkpoint", flush=True)
            await asyncio.sleep(60)
        value = await super().invoke(task, payload)
        if task == "decide" and not payload["observations"]:
            value["value"]["arguments"]["query"] = payload["context"]["subject"]
        return value


original = McpTools.call


async def tool_probe(self, name, args):
    result = await original(self, name, args)
    if name == "get_thread_context" and os.environ.get("A3_HOOK") == "tool":
        print("READY:tool", flush=True)
        await asyncio.sleep(60)
    return result


def main():
    command = Command.model_validate(json.loads(sys.stdin.read()))
    model = ProbeModel()
    runtime = DurableRuntime(
        Store(os.environ["AGENT_CHECKPOINT_DATABASE_URL"]),
        ProbeBridge(os.environ["AGENT_BRIDGE_URL"], os.environ["AGENT_BRIDGE_TOKEN"]),
        os.environ["AGENT_MCP_URL"],
        os.environ["MCP_CAPABILITY"],
        model,
    )
    app = create_app(
        "s" * 32, command.runId, os.environ["AGENT_MCP_URL"], os.environ["MCP_CAPABILITY"], model, runtime=runtime
    )
    with TestClient(app, base_url="http://127.0.0.1:8102", headers={"Authorization": "Bearer " + "s" * 32}) as client:
        result = client.post("/runs", json=command.model_dump())
        if result.status_code != 200:
            print("RESULT:" + json.dumps(result.json()), flush=True)
            raise RuntimeError("Durable request failed")
        data = result.json()
        print(
            "RESULT:"
            + json.dumps({"status": data["status"], "code": data.get("code"), "revision": data.get("revision")}),
            flush=True,
        )
        assert client.get("/runs/" + command.runId).status_code == 200


if __name__ == "__main__":
    from unittest.mock import patch

    with patch.object(McpTools, "call", tool_probe):
        main()
