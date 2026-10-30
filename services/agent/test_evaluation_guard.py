import asyncio
import io
import json
import pytest
from test_workflow import command
from evaluation_worker import main


def test_evaluation_worker_refuses_live_before_mcp_or_provider(monkeypatch):
    monkeypatch.setenv("A4_LIVE", "true")
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(command().model_dump())))
    monkeypatch.delenv("A1_MCP_URL", raising=False)
    with pytest.raises(ValueError, match="Live coordinator"):
        asyncio.run(main())
