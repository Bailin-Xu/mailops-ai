import asyncio
import json
from pathlib import Path
import pytest
from contracts import Command, DraftRef
from models import MockModel, TransientModelError
from tracing import Trace
from workflow import Workflow

ID = "12345678-1234-4234-8234-123456781234"
REV = "22345678-1234-4234-8234-123456781234"
SOURCE = {
    "entryId": ID,
    "revisionId": REV,
    "contentHash": "b" * 64,
    "title": "Delivery policy",
    "answer": "Le délai est de sept jours.",
    "language": "fr",
    "trust": "UNTRUSTED_TEXT",
}
CONTEXT = {
    "threadId": ID,
    "contextHash": "a" * 64,
    "subject": "Question",
    "body": "Quel est le délai ?",
    "language": "fr",
    "trust": "UNTRUSTED_TEXT",
}


def command():
    data = json.loads((Path(__file__).parents[2] / "contracts/agent/fixtures.json").read_text())[0]["value"]
    data.update(graphVersion="agent-graph-v1", policyVersion="agent-policy-v1", promptVersion="agent-prompt-v1")
    return Command.model_validate(data)


class Tools:
    def __init__(self, sources=None):
        self.calls = []
        self.sources = [SOURCE] if sources is None else sources

    async def call(self, name, args):
        self.calls.append((name, args))
        return (
            CONTEXT
            if name == "get_thread_context"
            else ({"sources": self.sources} if name == "search_approved_knowledge" else SOURCE)
        )


class Script(MockModel):
    def __init__(self, actions, classification=None):
        self.actions = iter(actions)
        self.classification = classification

    async def invoke(self, task, payload):
        if task == "classify":
            if self.classification is not None:
                return {"value": self.classification, "usage": None}
            return await super().invoke(task, payload)
        value = next(self.actions)
        if isinstance(value, Exception):
            raise value
        return {"value": value, "usage": None}


def action(name, **args):
    return {"name": name, "arguments": args}


def run(tmp_path, monkeypatch, model=None, tools=None, exporter=None, seconds=120, command_input=None):
    monkeypatch.chdir(tmp_path)
    c = command_input or command()
    trace = Trace(c.runId, c.traceId, exporter)
    t = tools or Tools()
    w = Workflow(c, model or MockModel(), t, trace, seconds)
    return asyncio.run(w.run()), t, trace


def test_direct_and_trace(tmp_path, monkeypatch):
    result, t, trace = run(tmp_path, monkeypatch)
    assert result["proposal"]["body"] == SOURCE["answer"]
    assert [n for n, _ in t.calls] == [
        "get_thread_context",
        "search_approved_knowledge",
        "get_knowledge_revision",
        "get_knowledge_revision",
    ]
    assert result["model_calls"] == 4 and result["status"] == "WAITING_FOR_HUMAN"
    text = json.dumps(trace.events)
    assert CONTEXT["body"] not in text and SOURCE["answer"] not in text
    assert "agent-graph-v1" in text


def test_reformulate(tmp_path, monkeypatch):
    model = Script(
        [
            action("Search", query="nothing", language="fr", limit=8),
            action("Search", query="policy", language="fr", limit=8),
            action("Inspect", reference=REV),
            action("Draft", reference=REV, subject="Réponse", body=SOURCE["answer"], language="fr"),
        ]
    )
    result, t, _ = run(tmp_path, monkeypatch, model)
    assert result["proposal"]["outcome"] == "DRAFT"
    assert [a["query"] for n, a in t.calls if n == "search_approved_knowledge"] == ["nothing", "policy"]


@pytest.mark.parametrize("reason", ["NO_EVIDENCE", "CONFLICT"])
def test_escalation(tmp_path, monkeypatch, reason):
    result, _, _ = run(tmp_path, monkeypatch, Script([action("Escalate", reason=reason)]))
    assert result["proposal"]["reason"] == reason and result["proposal"]["body"] is None


def test_no_results(tmp_path, monkeypatch):
    result, _, _ = run(tmp_path, monkeypatch, tools=Tools([]))
    assert result["proposal"]["reason"] == "NO_EVIDENCE"


@pytest.mark.parametrize(
    "value",
    [
        action("send_email"),
        {"invalid": True},
        action("Draft", reference=REV, subject="x", body="x", language="fr"),
        action("Inspect", reference=REV),
    ],
)
def test_invalid_actions(tmp_path, monkeypatch, value):
    result, t, _ = run(tmp_path, monkeypatch, Script([value]))
    assert result["status"] == "FAILED" and result["proposal"] is None
    assert len(t.calls) == 1


def test_budget(tmp_path, monkeypatch):
    result, _, _ = run(tmp_path, monkeypatch, Script([action("Search", query="policy", language="fr", limit=8)] * 10))
    assert result["code"] == "BUDGET" and result["model_calls"] == 6


def test_low_confidence(tmp_path, monkeypatch):
    result, t, _ = run(
        tmp_path,
        monkeypatch,
        Script([], {"category": "KNOWN_QUESTION", "confidence": 0.6, "language": "fr", "requiresHumanReview": False}),
    )
    assert result["proposal"]["reason"] == "POLICY" and len(t.calls) == 1


def test_export_failure(tmp_path, monkeypatch):
    def broken(_event):
        raise ValueError("private secret must not leak")

    result, _, trace = run(tmp_path, monkeypatch, exporter=broken)
    assert result["proposal"]["outcome"] == "DRAFT"
    assert "private secret" not in json.dumps(trace.events)
    assert any(e["code"] == "EXPORT_FAILED" for e in trace.events)


def test_retry(tmp_path, monkeypatch):
    result, _, _ = run(tmp_path, monkeypatch, Script([TransientModelError(), action("Escalate", reason="POLICY")]))
    assert result["model_calls"] == 3 and result["proposal"]["reason"] == "POLICY"


def test_deadline(tmp_path, monkeypatch):
    class Slow(MockModel):
        async def invoke(self, task, payload):
            await asyncio.sleep(0.1)
            return await super().invoke(task, payload)

    result, _, _ = run(tmp_path, monkeypatch, Slow(), seconds=0.01)
    assert result["code"] == "BUDGET"


def test_api_auth_and_command():
    from fastapi.testclient import TestClient
    from api import create_app

    app = create_app("s" * 32, ID, "http://127.0.0.1:8103/mcp", "c" * 32)
    with TestClient(app, base_url="http://127.0.0.1:8102") as client:
        assert client.get("/runs/" + ID).status_code == 401
        headers = {"Authorization": "Bearer " + "s" * 32}
        assert client.get("/runs/" + ID, headers=headers).status_code == 404
        c = command().model_dump()
        c["action"] = "RESUME"
        assert client.post("/runs", headers=headers, json=c).status_code == 409


def test_gemini_native_tool_adapter(monkeypatch):
    from types import SimpleNamespace
    import langchain_google_genai
    from models import GeminiModel
    from decisions import Classification

    bound: list[str] = []

    class Client:
        def __init__(self, **config):
            assert config["max_retries"] == 0 and config["max_output_tokens"] == 2048

        def with_structured_output(self, schema, **options):
            self.classifying = True
            return self

        def bind_tools(self, tools):
            bound.extend(t.__name__ for t in tools)
            self.classifying = False
            return self

        async def ainvoke(self, messages):
            assert len(messages) == 2
            raw = SimpleNamespace(usage_metadata={"input_tokens": 10, "output_tokens": 5})
            if self.classifying:
                return {
                    "parsed": Classification(
                        category="KNOWN_QUESTION", language="fr", confidence=0.9, requiresHumanReview=False
                    ),
                    "raw": raw,
                }
            return SimpleNamespace(
                tool_calls=[{"name": "Search", "args": {"query": "policy", "language": "fr", "limit": 8}}],
                usage_metadata=raw.usage_metadata,
            )

    monkeypatch.setattr(langchain_google_genai, "ChatGoogleGenerativeAI", Client)
    model = GeminiModel("configured-model", "not-a-real-key")
    classified = asyncio.run(model.invoke("classify", {"context": CONTEXT}))
    decided = asyncio.run(model.invoke("decide", {"context": CONTEXT}))
    assert classified["value"]["language"] == "fr"
    assert decided["value"]["name"] == "Search" and decided["usage"]["input_tokens"] == 10
    assert bound == ["Search", "Inspect", "Draft", "Escalate"]


def test_tool_budget_counts_retries(tmp_path, monkeypatch):
    class Flaky(Tools):
        def __init__(self):
            super().__init__()
            self.attempts = 0

        async def call(self, name, args):
            self.attempts += 1
            if self.attempts % 2:
                raise TimeoutError()
            return await super().call(name, args)

    result, _, _ = run(
        tmp_path, monkeypatch, Script([action("Search", query="policy", language="fr", limit=8)] * 10), Flaky()
    )
    assert result["code"] == "BUDGET" and result["tool_calls"] == 8


def test_context_and_revision_changes_fail_closed(tmp_path, monkeypatch):
    class Stale(Tools):
        async def call(self, name, args):
            data = await super().call(name, args)
            if name == "get_thread_context":
                return {**data, "contextHash": "c" * 64}
            return data

    result, _, _ = run(tmp_path, monkeypatch, tools=Stale())
    assert result["code"] == "STALE" and result["model_calls"] == 0

    class Revoked(Tools):
        async def call(self, name, args):
            data = await super().call(name, args)
            if name == "get_knowledge_revision" and len(self.calls) == 4:
                return {**data, "contentHash": "c" * 64}
            return data

    result, _, _ = run(tmp_path, monkeypatch, tools=Revoked())
    assert result["code"] == "STALE" and result["proposal"] is None


@pytest.mark.parametrize(
    "classification",
    [{}, {"category": "KNOWN_QUESTION", "language": "en", "confidence": 0.99, "requiresHumanReview": False}],
)
def test_invalid_or_wrong_language_classification(tmp_path, monkeypatch, classification):
    result, t, _ = run(tmp_path, monkeypatch, Script([], classification))
    assert result["proposal"] is None or result["proposal"]["reason"] == "POLICY"
    assert len(t.calls) == 1


def test_input_budget_prevents_model_request(tmp_path, monkeypatch):
    class Long(Tools):
        async def call(self, name, args):
            return {**CONTEXT, "body": "é" * 15000}

    result, _, _ = run(tmp_path, monkeypatch, tools=Long())
    assert result["code"] == "BUDGET" and result["model_calls"] == 0


def test_permanent_provider_failure_preserves_previous_reference(tmp_path, monkeypatch):
    c = command()
    c.context.draft = DraftRef(id=ID, reviewRevision=5)
    before = c.model_dump()
    # Workflow never has a business write capability, including when the model fails.
    result, _, trace = run(tmp_path, monkeypatch, Script([ValueError("private error content")]), command_input=c)
    assert result["status"] == "FAILED" and result["proposal"] is None
    assert "private error content" not in json.dumps(trace.events)
    assert c.model_dump() == before


def test_wrong_language_evidence_rejected(tmp_path, monkeypatch):
    result, _, _ = run(tmp_path, monkeypatch, tools=Tools([{**SOURCE, "language": "en"}]))
    assert result["code"] == "UNTRUSTED_SOURCE" and result["proposal"] is None


def test_ui_mock_uses_bounded_subject_without_changing_evaluation_model(tmp_path, monkeypatch):
    from models import InteractiveMockModel

    result, tools, _ = run(tmp_path, monkeypatch, InteractiveMockModel())
    assert result["status"] == "WAITING_FOR_HUMAN"
    assert tools.calls[1][1]["query"] == CONTEXT["subject"]
    _, baseline, _ = run(tmp_path, monkeypatch)
    assert baseline.calls[1][1]["query"] == "policy"
    payload = {"context": {**CONTEXT, "subject": "é" * 700}, "observations": []}
    decision = asyncio.run(InteractiveMockModel().invoke("decide", payload))
    assert len(decision["value"]["arguments"]["query"]) == 500
