"""Sanitized metadata events; provider automatic tracing is disabled by caller."""

import json
import os
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4


class Trace:
    def __init__(self, run_id: str, trace_id: str, exporter: Callable[[dict[str, Any]], None] | None = None):
        self.run_id, self.trace_id = run_id, trace_id
        self.events: list[dict[str, Any]] = []
        self.exporter = exporter

    def emit(self, kind: str, code: str = "OK", **metadata: Any) -> None:
        # Deliberately build an allowlist; never accept bodies, prompts or exception text.
        allowed = {
            "model",
            "input_tokens",
            "output_tokens",
            "elapsed_ms",
            "attempt",
            "tool",
            "graph_version",
            "policy_version",
            "prompt_version",
        }
        event = {
            "event_id": str(uuid4()),
            "run_id": self.run_id,
            "trace_id": self.trace_id,
            "sequence": len(self.events),
            "kind": kind,
            "code": code,
            **{k: v for k, v in metadata.items() if k in allowed},
        }
        self._append(event)
        if self.exporter:
            try:
                self.exporter(event)
            except Exception:
                self._append(
                    {
                        **event,
                        "event_id": str(uuid4()),
                        "sequence": len(self.events),
                        "kind": "export",
                        "code": "EXPORT_FAILED",
                    }
                )

    def _append(self, event: dict[str, Any]) -> None:
        self.events.append(event)
        path = Path("data/agent-runs") / f"{self.run_id}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a") as stream:
            stream.write(json.dumps(event) + "\n")


class LangSmithExporter:
    def __init__(self, api_key: str):
        from langsmith import Client

        self.client = Client(
            api_key=api_key,
            api_url="https://api.smith.langchain.com",
            auto_batch_tracing=False,
            timeout_ms=1000,
            omit_traced_runtime_info=True,
        )

    def __call__(self, event: dict[str, Any]) -> None:
        self.client.create_run(
            name="mailops-agent-event", run_type="chain", inputs={}, id=event["event_id"], extra={"metadata": event}
        )
