"""Bounded, nonpersistent LangGraph execution returning a proposal only."""

import asyncio
import json
import time
from typing import Any, Protocol, TypedDict
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command as GraphCommand
from langsmith import tracing_context
from contracts import Command, Proposal
from decisions import Classification, DECISIONS, Draft, Escalate, Inspect, Search
from models import Model, TransientModelError
from tracing import Trace
from mcp_client import SourceResult, ThreadResult, SearchResult


class Tools(Protocol):
    async def call(self, name: str, args: dict[str, Any]) -> dict[str, Any]: ...


class Halt(Exception):
    def __init__(self, code: str):
        self.code = code


class State(TypedDict, total=False):
    context: dict[str, Any]
    classification: dict[str, Any]
    observations: list[dict[str, Any]]
    decision: dict[str, Any]
    proposal: dict[str, Any]
    done: bool


class Workflow:
    def __init__(
        self, command: Command, model: Model, tools: Tools, trace: Trace, seconds: float = 120, reserve: Any = None
    ):
        self.command, self.model, self.tools, self.trace = command, model, tools, trace
        self.reserve = reserve
        self.seconds = min(seconds, 120)
        self.model_calls = self.tool_calls = 0
        self.verified: dict[str, SourceResult] = {}
        self.retrieved: dict[str, SourceResult] = {}
        self.language = "en"

    async def tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(2):
            if self.tool_calls >= 8:
                raise Halt("BUDGET")
            if self.reserve:
                counts = await self.reserve("tool")
                self.model_calls = counts["models"]
                self.tool_calls = counts["tools"]
            else:
                self.tool_calls += 1
            self.trace.emit("tool_start", tool=name, attempt=attempt + 1)
            try:
                result = await asyncio.wait_for(self.tools.call(name, {"runId": self.command.runId, **args}), 5)
                self.trace.emit("tool_end", tool=name)
                return result
            except TimeoutError:
                self.trace.emit("tool_end", "TIMEOUT", tool=name)
                if attempt == 1:
                    raise Halt("TIMEOUT") from None
        raise Halt("TIMEOUT")

    async def model_call(self, task: str, payload: dict[str, Any]) -> Any:
        # UTF-8 byte count is conservative versus tokens; includes all supplied context.
        if len(json.dumps(payload, ensure_ascii=False).encode()) + 4096 > 16000:
            raise Halt("BUDGET")
        for attempt in range(2):
            if self.model_calls >= 6:
                raise Halt("BUDGET")
            if self.reserve:
                counts = await self.reserve("model")
                self.model_calls = counts["models"]
                self.tool_calls = counts["tools"]
            else:
                self.model_calls += 1
            started = time.monotonic()
            self.trace.emit("model_start", model=self.model.id, attempt=attempt + 1)
            try:
                with tracing_context(enabled=False):
                    result = await asyncio.wait_for(self.model.invoke(task, payload), 20)
                if len(json.dumps(result["value"], ensure_ascii=False).encode()) > 2048:
                    raise Halt("BUDGET")
                usage = result.get("usage") or {}
                if (usage.get("input_tokens") or 0) > 16000 or (usage.get("output_tokens") or 0) > 2048:
                    raise Halt("BUDGET")
                self.trace.emit(
                    "model_end",
                    model=self.model.id,
                    elapsed_ms=int((time.monotonic() - started) * 1000),
                    input_tokens=usage.get("input_tokens"),
                    output_tokens=usage.get("output_tokens"),
                )
                return result["value"]
            except (TimeoutError, TransientModelError):
                self.trace.emit("model_end", "PROVIDER_ERROR", model=self.model.id)
                if attempt == 1:
                    raise Halt("PROVIDER_ERROR") from None
        raise Halt("PROVIDER_ERROR")

    def proposal(self, reason: str, draft: Draft | None = None) -> dict[str, Any]:
        c = self.command
        source = self.verified.get(draft.reference) if draft else None
        return Proposal.model_validate(
            {
                "contractVersion": "agent-v1",
                "runId": c.runId,
                "commandId": c.commandId,
                "fence": c.fence,
                "context": c.context.model_dump(),
                "outcome": "DRAFT" if draft else "ESCALATE",
                "subject": draft.subject if draft else None,
                "body": draft.body if draft else None,
                "language": self.language,
                "source": {
                    "entryId": source.entryId,
                    "revisionId": source.revisionId,
                    "contentHash": source.contentHash,
                }
                if source
                else None,
                "reason": reason,
            }
        ).model_dump()

    async def load(self, state: State) -> State:
        self.trace.emit("node_context")
        context = ThreadResult.model_validate(
            await self.tool("get_thread_context", {"reference": self.command.context.threadId})
        )
        if context.threadId != self.command.context.threadId or context.contextHash != self.command.context.contextHash:
            raise Halt("STALE")
        self.language = context.language
        return {"context": context.model_dump(), "observations": [], "done": False}

    async def classify(self, state: State) -> State:
        self.trace.emit("node_classify")
        classification = Classification.model_validate(await self.model_call("classify", {"context": state["context"]}))
        data: State = {"classification": classification.model_dump()}
        if (
            classification.confidence < 0.7
            or classification.requiresHumanReview
            or classification.language != self.language
            or classification.category not in ["KNOWN_QUESTION", "UNKNOWN_QUESTION"]
        ):
            data["done"] = True
            data["proposal"] = self.proposal("POLICY")
        return data

    async def decide(self, state: State) -> State:
        self.trace.emit("node_decide")
        value = await self.model_call(
            "decide",
            {
                "context": state["context"],
                "classification": state["classification"],
                "observations": state["observations"],
            },
        )
        if not isinstance(value, dict) or set(value) != {"name", "arguments"} or value["name"] not in DECISIONS:
            raise Halt("INVALID_OUTPUT")
        decision = DECISIONS[value["name"]].model_validate(value["arguments"])
        if isinstance(decision, Escalate):
            return {"done": True, "proposal": self.proposal(decision.reason)}
        if isinstance(decision, Draft):
            if decision.language != self.language or decision.reference not in self.verified:
                raise Halt("UNTRUSTED_SOURCE")
            # Fresh re-read prevents a draft from using a revision changed during this run.
            source = SourceResult.model_validate(
                await self.tool("get_knowledge_revision", {"reference": decision.reference})
            )
            if source != self.verified[decision.reference]:
                raise Halt("STALE")
            return {"done": True, "proposal": self.proposal("SUPPORTED", decision)}
        return {"decision": {"name": value["name"], "arguments": decision.model_dump()}}

    async def act(self, state: State) -> State:
        self.trace.emit("node_tool")
        action = state["decision"]
        if action["name"] == "Search":
            args = Search.model_validate(action["arguments"])
            if args.language != self.language:
                raise Halt("POLICY")
            result = SearchResult.model_validate(
                await self.tool("search_approved_knowledge", args.model_dump())
            ).model_dump()
            for item in result["sources"]:
                source_item = SourceResult.model_validate(item)
                if source_item.language != self.language:
                    raise Halt("UNTRUSTED_SOURCE")
                self.retrieved[source_item.revisionId] = source_item
        else:
            args2 = Inspect.model_validate(action["arguments"])
            if args2.reference not in self.retrieved:
                raise Halt("UNTRUSTED_SOURCE")
            source = SourceResult.model_validate(await self.tool("get_knowledge_revision", args2.model_dump()))
            if source.revisionId != args2.reference or source.language != self.language:
                raise Halt("UNTRUSTED_SOURCE")
            if source != self.retrieved[args2.reference]:
                raise Halt("STALE")
            self.verified[source.revisionId] = source
            result = source.model_dump()
        return {
            "observations": [
                *state["observations"],
                {"name": action["name"], "arguments": action["arguments"], "result": result},
            ]
        }

    async def handoff(self, state: State) -> State:
        interrupt({"kind": "HUMAN_REVIEW", "outcome": state["proposal"]["outcome"]})
        return {}

    async def run(
        self, checkpointer: Any = None, continuation: bool = False, expect_checkpoint: bool = False
    ) -> dict[str, Any]:
        self.trace.emit(
            "run_start",
            model=self.model.id,
            graph_version=self.command.graphVersion,
            policy_version=self.command.policyVersion,
            prompt_version=self.command.promptVersion,
        )
        graph = StateGraph(State)
        graph.add_node("context", self.load)
        graph.add_node("classify", self.classify)
        graph.add_node("decide", self.decide)
        graph.add_node("tool", self.act)
        graph.add_edge(START, "context")
        graph.add_edge("context", "classify")
        graph.add_conditional_edges(
            "classify", lambda s: ("handoff" if checkpointer else END) if s.get("done") else "decide"
        )
        graph.add_conditional_edges(
            "decide", lambda s: ("handoff" if checkpointer else END) if s.get("done") else "tool"
        )
        graph.add_edge("tool", "decide")
        if checkpointer:
            graph.add_node("handoff", self.handoff)
            graph.add_edge("handoff", END)
        compiled = graph.compile(checkpointer=checkpointer)
        config: RunnableConfig = {"recursion_limit": 40, "configurable": {"thread_id": self.command.runId}}
        incoming: Any = {}
        try:
            if checkpointer:
                saved = await compiled.aget_state(config)
                if expect_checkpoint and not saved.values and not saved.next:
                    raise Halt("CHECKPOINT_UNAVAILABLE")
                if saved.next:
                    incoming = GraphCommand(resume="CONTINUE") if saved.interrupts and continuation else None
                if saved.values and "context" in saved.values:
                    values = saved.values
                    self.language = values["context"]["language"]
                    # Reauthorize current context and saved evidence after process/server restart.
                    current = ThreadResult.model_validate(
                        await self.tool("get_thread_context", {"reference": self.command.context.threadId})
                    )
                    if current.contextHash != self.command.context.contextHash:
                        raise Halt("STALE")
                    refreshed: dict[str, SourceResult] = {}
                    for observation in values.get("observations", []):
                        if observation["name"] == "Search":
                            # Search arguments are persisted in the observation, never read from model text.
                            args = observation.get("arguments")
                            if args:
                                fresh = SearchResult.model_validate(await self.tool("search_approved_knowledge", args))
                                refreshed.update({s.revisionId: s for s in fresh.sources})
                        elif observation["name"] == "Inspect":
                            old = SourceResult.model_validate(observation["result"])
                            if refreshed.get(old.revisionId) != old:
                                raise Halt("STALE")
                            now = SourceResult.model_validate(
                                await self.tool("get_knowledge_revision", {"reference": old.revisionId})
                            )
                            if now != old:
                                raise Halt("STALE")
                            self.verified[old.revisionId] = old
                    self.retrieved = {
                        s["revisionId"]: SourceResult.model_validate(s)
                        for o in values.get("observations", [])
                        if o["name"] == "Search"
                        for s in o["result"]["sources"]
                    }
                    incoming = GraphCommand(resume="CONTINUE") if saved.interrupts and continuation else None
            with tracing_context(enabled=False):
                state = await asyncio.wait_for(
                    (
                        compiled.ainvoke(incoming, config=config, durability="sync")
                        if checkpointer
                        else compiled.ainvoke(incoming, config=config)
                    ),
                    self.seconds,
                )
            result = {
                "status": "WAITING_FOR_HUMAN"
                if not checkpointer or state.get("__interrupt__")
                else "PROPOSAL_ACCEPTABLE",
                "code": "OK",
                "proposal": state["proposal"],
                "classification": state.get("classification"),
                "observations": state.get("observations", []),
            }
        except Halt as error:
            result = {
                "status": "STALE"
                if error.code == "STALE"
                else ("WAITING_FOR_HUMAN" if error.code == "BUDGET" else "FAILED"),
                "code": error.code,
                "proposal": self.proposal("BUDGET") if error.code == "BUDGET" else None,
            }
        except TimeoutError:
            result = {"status": "WAITING_FOR_HUMAN", "code": "BUDGET", "proposal": self.proposal("BUDGET")}
        except Exception:
            result = {"status": "FAILED", "code": "INVALID_OR_UNAVAILABLE", "proposal": None}
        self.trace.emit("run_end", result["code"])
        return {**result, "model_calls": self.model_calls, "tool_calls": self.tool_calls}
