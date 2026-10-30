"""A0 boundary validation only; no Agent execution or network calls."""

import json
from pathlib import Path
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(min_length=1, max_length=80)]
Id = Annotated[
    str,
    StringConstraints(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
    ),
]
Hash = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
Revision = Annotated[StrictInt, Field(ge=0)]
Fence = Annotated[StrictInt, Field(ge=1)]


class Boundary(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class DraftRef(Boundary):
    id: Id
    reviewRevision: Revision


class Context(Boundary):
    threadId: Id
    contextHash: Hash
    classificationRevision: Revision
    draft: DraftRef | None


class Command(Boundary):
    contractVersion: Literal["agent-v1"]
    action: Literal["START", "RESUME", "CANCEL"]
    runId: Id
    commandId: Id
    expectedRunRevision: Revision
    fence: Fence
    context: Context
    graphVersion: Text
    policyVersion: Text
    promptVersion: Text
    traceId: Id


class Source(Boundary):
    entryId: Id
    revisionId: Id
    contentHash: Hash


class Proposal(Boundary):
    contractVersion: Literal["agent-v1"]
    runId: Id
    commandId: Id
    fence: Fence
    context: Context
    outcome: Literal["DRAFT", "ESCALATE"]
    subject: Annotated[str, StringConstraints(min_length=1, max_length=500)] | None
    body: Annotated[str, StringConstraints(min_length=1, max_length=20000)] | None
    language: Literal["en", "fr"]
    source: Source | None
    reason: Literal["SUPPORTED", "NO_EVIDENCE", "CONFLICT", "POLICY", "BUDGET"]

    @model_validator(mode="after")
    def outcome_fields(self):
        valid = (
            (bool(self.subject and self.body and self.source) and self.reason == "SUPPORTED")
            if self.outcome == "DRAFT"
            else (self.subject is None and self.body is None and self.source is None and self.reason != "SUPPORTED")
        )
        if not valid:
            raise ValueError("Invalid proposal outcome")
        return self


class Tool(Boundary):
    contractVersion: Literal["agent-v1"]
    runId: Id
    toolCallId: Id
    tool: Literal["get_thread_context", "search_approved_knowledge", "get_knowledge_revision"]
    reference: Id | None
    query: Annotated[str, StringConstraints(min_length=2, max_length=500)] | None
    language: Literal["en", "fr"]
    limit: Annotated[StrictInt, Field(ge=1, le=8)]

    @model_validator(mode="after")
    def arguments(self):
        valid = (
            (self.query is not None and self.reference is None)
            if self.tool == "search_approved_knowledge"
            else (self.reference is not None and self.query is None)
        )
        if not valid:
            raise ValueError("Invalid tool arguments")
        return self


class Event(Boundary):
    contractVersion: Literal["agent-v1"]
    runId: Id
    traceId: Id
    eventId: Id
    sequence: Revision
    status: Literal["RUNNING", "WAITING_FOR_HUMAN", "SUCCEEDED", "FAILED", "CANCELLED", "STALE"]
    code: Literal["OK", "INVALID_INPUT", "CONFLICT", "UNAUTHORIZED", "TIMEOUT", "BUDGET", "PROVIDER_ERROR"]
    retryable: bool
    model: Text | None
    inputTokens: Revision | None
    outputTokens: Revision | None


MODELS: dict[str, type[Boundary]] = {"command": Command, "proposal": Proposal, "tool": Tool, "event": Event}


def check_fixtures():
    fixtures = json.loads((Path(__file__).parents[2] / "contracts/agent/fixtures.json").read_text())
    for case in fixtures:
        try:
            MODELS[case["kind"]].model_validate(case["value"])
            accepted = True
        except ValueError:
            accepted = False
        assert accepted == case["valid"], case["name"]
    print(f"Python contracts: {len(fixtures)} cases passed")


if __name__ == "__main__":
    check_fixtures()
