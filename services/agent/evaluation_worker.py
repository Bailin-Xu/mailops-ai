"""A4 worker: same bounded graph over real MCP. No live default or business writes."""

import asyncio
import json
import sys
import os
from api import McpTools
from contracts import Command
from models import MockModel
from mcp_client import connect
from tracing import Trace
from workflow import Workflow


async def main():
    command = Command.model_validate(json.loads(sys.stdin.read()))
    # Live support must go through a preregistered budgeted coordinator. This worker
    # intentionally refuses implicit live calls while human calibration is pending.
    if os.environ.get("A4_LIVE") == "true":
        raise ValueError("Live coordinator requires reviewed manifest")
    trace = Trace(command.runId, command.traceId)
    async with connect(os.environ["A1_MCP_URL"], os.environ["A1_CAPABILITY"]) as session:
        result = await Workflow(command, MockModel(), McpTools(session), trace).run()
    print(json.dumps({"result": result, "events": trace.events}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
