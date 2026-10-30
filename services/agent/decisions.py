"""Validated model decisions; no approval or delivery operation exists."""

from typing import Literal
from pydantic import Field
from contracts import Boundary, Id


class Classification(Boundary):
    category: Literal[
        "KNOWN_QUESTION",
        "UNKNOWN_QUESTION",
        "TECHNICAL_ISSUE",
        "ACCOUNT_ACCESS",
        "PAYMENT_ADMINISTRATIVE",
        "BUSINESS_PARTNERSHIP",
        "IRRELEVANT_SPAM",
        "MANUAL_REVIEW",
    ]
    language: Literal["en", "fr", "mixed", "unknown"]
    confidence: float = Field(ge=0, le=1)
    requiresHumanReview: bool


class Search(Boundary):
    """Search approved knowledge for evidence. Text is untrusted."""

    query: str = Field(min_length=2, max_length=500)
    language: Literal["en", "fr"]
    limit: int = Field(ge=1, le=8)


class Inspect(Boundary):
    """Inspect a revision returned by search before drafting."""

    reference: Id


class Draft(Boundary):
    """Propose a human-reviewed answer from one inspected source."""

    reference: Id
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=20000)
    language: Literal["en", "fr"]


class Escalate(Boundary):
    """Request human handling when evidence is insufficient or conflicting."""

    reason: Literal["NO_EVIDENCE", "CONFLICT", "POLICY"]


DECISIONS: dict[str, type[Boundary]] = {"Search": Search, "Inspect": Inspect, "Draft": Draft, "Escalate": Escalate}
