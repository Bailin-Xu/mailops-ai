"""Local run/status API. A2 is nonpersistent and never commits business state."""

import os
import secrets
import re
import math
from hashlib import sha256
from pathlib import Path
from typing import Callable
from typing import Any
from fastapi import FastAPI, HTTPException, Request
from contracts import Command
from models import Model, MockModel, GeminiModel
from mcp_client import connect, call_tool
from tracing import Trace, LangSmithExporter
from workflow import Workflow


class McpTools:
    def __init__(self, session: Any):
        self.session = session

    async def call(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        result = await call_tool(self.session, name, args)
        if result.is_error:
            raise ValueError("MCP_TOOL_ERROR")
        return dict(result.structured_content)


def create_app(
    token: str,
    run_id: str,
    mcp_url: str,
    capability: str,
    model: Model | None = None,
    exporter: Callable[[dict[str, Any]], None] | None = None,
) -> FastAPI:
    if len(token) < 32:
        raise ValueError("Explicit service credential required")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    records: dict[str, dict[str, Any]] = {}
    selected_model = model or MockModel()

    @app.middleware("http")
    async def boundary(request: Request, next_handler: Any) -> Any:
        from fastapi.responses import JSONResponse

        if request.headers.get("origin") or not re.fullmatch(
            r"127\.0\.0\.1:[0-9]{1,5}", request.headers.get("host", "")
        ):
            return JSONResponse({"code": "REJECTED"}, status_code=403)
        if not secrets.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {token}".encode()):
            return JSONResponse({"code": "UNAUTHORIZED"}, status_code=401)
        return await next_handler(request)

    @app.post("/runs")
    async def start(command: Command) -> dict[str, Any]:
        if command.runId != run_id:
            raise HTTPException(403, "UNAUTHORIZED")
        if (
            command.action != "START"
            or command.expectedRunRevision != 0
            or (command.graphVersion, command.policyVersion, command.promptVersion)
            != ("agent-graph-v1", "agent-policy-v1", "agent-prompt-v1")
        ):
            raise HTTPException(409, "UNSUPPORTED_COMMAND_OR_VERSION")
        if run_id in records:
            raise HTTPException(409, "RUN_ALREADY_EXISTS")
        trace = Trace(run_id, command.traceId, exporter)
        records[run_id] = {"status": "RUNNING", "code": "OK", "events": trace.events}
        try:
            async with connect(mcp_url, capability) as session:
                result = await Workflow(command, selected_model, McpTools(session), trace).run()
        except Exception:
            trace.emit("run_end", "MCP_UNAVAILABLE")
            result = {"status": "FAILED", "code": "MCP_UNAVAILABLE", "proposal": None}
        records[run_id] = {**result, "events": trace.events}
        return records[run_id]

    @app.get("/runs/{requested_id}")
    async def status(requested_id: str) -> dict[str, Any]:
        if requested_id != run_id or requested_id not in records:
            raise HTTPException(404, "RUN_NOT_FOUND")
        return records[requested_id]

    return app


def from_environment() -> FastAPI:
    # No environment-controlled automatic tracing of full model payloads.
    for key in ["LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2"]:
        os.environ[key] = "false"
    if os.environ.get("AGENT_MODEL_PROVIDER", "mock") not in ["mock", "gemini"]:
        raise ValueError("Unknown model provider")
    selected: Model = MockModel()
    if os.environ.get("AGENT_MODEL_PROVIDER", "mock") == "gemini":
        expected = sha256(Path("contracts/agent/dataset.json").read_bytes()).hexdigest()
        if os.environ.get("AGENT_LIVE_ENABLED") != "true" or os.environ.get("AGENT_SYNTHETIC_HASH") != expected:
            raise ValueError("Explicit synthetic live configuration required")
        # Conservative full-run reservation, not a billing guarantee. A4 adds run manifests.
        max_spend = float(os.environ["AGENT_MAX_SPEND"])
        input_price = float(os.environ["AGENT_INPUT_PRICE_PER_MILLION"])
        output_price = float(os.environ["AGENT_OUTPUT_PRICE_PER_MILLION"])
        if not all(math.isfinite(v) and v > 0 for v in [max_spend, input_price, output_price]):
            raise ValueError("Explicit positive live budget/pricing required")
        if (
            not os.environ["AGENT_PRICING_SOURCE"]
            or not os.environ["AGENT_PRICING_DATE"]
            or not os.environ["AGENT_CURRENCY"]
        ):
            raise ValueError("Pricing provenance required")
        if max_spend < 6 * (16000 * input_price + 2048 * output_price) / 1000000:
            raise ValueError("Budget cannot reserve the maximum bounded run")
        selected = GeminiModel(os.environ["GEMINI_MODEL"], os.environ["GEMINI_API_KEY"])
    exporter = (
        LangSmithExporter(os.environ["LANGSMITH_API_KEY"])
        if os.environ.get("AGENT_TRACE_EXPORT_ENABLED") == "true"
        else None
    )
    return create_app(
        os.environ["AGENT_SERVICE_TOKEN"],
        os.environ["MCP_RUN_ID"],
        os.environ["AGENT_MCP_URL"],
        os.environ["MCP_CAPABILITY"],
        selected,
        exporter,
    )
