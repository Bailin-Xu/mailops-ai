"""Foreground local UI adapter. Only validated commands and deterministic mock AI."""

import asyncio
import json
import os
import sys
from contracts import Command
from models import InteractiveMockModel
from runtime import DurableRuntime
from bridge import Bridge
from store import Store
from langsmith import tracing_context


async def main():
    payload = json.loads(sys.stdin.read())
    read_only = payload.pop("readOnly", False) is True
    command = Command.model_validate(payload)
    runtime = DurableRuntime(
        Store(os.environ["AGENT_CHECKPOINT_DATABASE_URL"]),
        Bridge(os.environ["AGENT_BRIDGE_URL"], os.environ["AGENT_BRIDGE_TOKEN"]),
        os.environ["AGENT_MCP_URL"],
        os.environ["MCP_CAPABILITY"],
        InteractiveMockModel(),
    )
    with tracing_context(enabled=False):
        status = await runtime.status(command.runId) if read_only else None
        result = status.get("result", status) if status else await runtime.execute(command)
    preview = None
    if result.get("proposal"):
        preview = {
            "proposal": result["proposal"],
            "modelCalls": result.get("model_calls"),
            "toolCalls": result.get("tool_calls"),
            "steps": [o["name"] for o in result.get("observations", []) if o["name"] in ["Search", "Inspect"]],
            "code": result.get("code", "OK"),
        }
    print(json.dumps({"status": result["status"], "preview": preview}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        print("Mock Agent service is unavailable or the command is stale.", file=sys.stderr)
        sys.exit(2)
