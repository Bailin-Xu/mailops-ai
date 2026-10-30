"""Durable execution coordinator; only TS can admit or commit business work."""

import asyncio
from contextlib import suppress
from uuid import uuid4
from typing import Any
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from contracts import Command
from store import Store, RuntimeConflict
from checkpoints import FencedSaver
from bridge import Bridge
from tracing import Trace
from workflow import Workflow, Halt


class DurableRuntime:
    def __init__(self, store: Store, bridge: Bridge, mcp_url: str, capability: str, model: Any, exporter: Any = None):
        self.store, self.bridge, self.mcp_url, self.capability, self.model, self.exporter = (
            store,
            bridge,
            mcp_url,
            capability,
            model,
            exporter,
        )

    async def status(self, run_id):
        business = await self.bridge.call("STATUS", {"runId": run_id})
        if business["status"] == "COMMITTED":
            if not business.get("receipts"):
                raise RuntimeConflict("RECEIPT_MISSING")
            return {
                "status": "COMMITTED",
                "revision": business["revision"],
                "fence": business["fence"],
                "receipt": business["receipts"][0]["result"],
            }
        row = await self.store.get(run_id)
        return {
            "status": row["status"],
            "result": row["result"],
            "model_calls": row["models"],
            "tool_calls": row["tools"],
            "revision": business["revision"],
            "fence": business["fence"],
            "business_status": business["status"],
        }

    async def execute(self, command: Command):
        from api import McpTools
        from mcp_client import connect

        if command.action == "CANCEL":
            await self.bridge.call("CANCEL", {"runId": command.runId, "expectedRevision": command.expectedRunRevision})
            await self.store.cancel(command.runId)
            return {"status": "CANCELLED"}
        # Business receipts remain authoritative even if the checkpoint DB is lost.
        business = await self.bridge.call("STATUS", {"runId": command.runId})
        if business["status"] == "COMMITTED":
            if (
                command.action != "RESUME"
                or command.context.model_dump() != business["context"]
                or not business.get("receipts")
            ):
                raise RuntimeConflict("RUN_CONFLICT")
            return {"status": "COMMITTED", "receipt": business["receipts"][0]["result"]}
        if business["status"] == "CANCELLED":
            with suppress(Exception):
                await self.store.cancel(command.runId)
            return {"status": "CANCELLED"}
        owner = str(uuid4())
        row = await self.store.claim(command, owner, self.model.id)
        try:
            claimed = await self.bridge.call(
                "CLAIM",
                {
                    "runId": command.runId,
                    "owner": owner,
                    "commandId": command.commandId,
                    "expectedRevision": command.expectedRunRevision,
                },
            )
        except Exception as error:
            code = getattr(error, "code", "BUSINESS_CONFLICT")
            await self.store.finish(command.runId, owner, "STALE" if code == "STALE" else "FAILED", {"code": code})
            raise RuntimeConflict("BUSINESS_CONFLICT") from None
        fence = claimed["fence"]
        lease = {"runId": command.runId, "owner": owner, "fence": fence}
        original = Command.model_validate(row["command"]).model_copy(update={"fence": fence})
        trace = Trace(command.runId, original.traceId, self.exporter)
        parent = asyncio.current_task()

        async def heartbeat():
            try:
                while True:
                    await asyncio.sleep(10)
                    await self.bridge.call("CONTROL", {**lease, "action": "HEARTBEAT"})
                    await self.store.heartbeat(command.runId, owner)
            except Exception:
                if parent:
                    parent.cancel()

        beat = asyncio.create_task(heartbeat())

        async def reserve(kind):
            try:
                return await self.store.reserve(command.runId, owner, kind)
            except RuntimeConflict:
                raise Halt("BUDGET") from None

        async def submit(submission):
            await self.store.save_submission(command.runId, owner, submission)
            try:
                receipt = await self.bridge.call("COMMIT", submission)
            except Exception as error:
                if getattr(error, "code", None) == "STALE":
                    with suppress(Exception):
                        await self.bridge.call("CONTROL", {**lease, "action": "STALE"})
                    await self.store.finish(command.runId, owner, "STALE", {"code": "STALE"})
                    return {"status": "STALE", "code": "STALE"}
                await self.store.finish(command.runId, owner, "FAILED", {"code": "COMMIT_UNKNOWN"})
                return {"status": "FAILED", "code": "COMMIT_UNKNOWN"}
            await self.store.finish(command.runId, owner, "COMMITTED", receipt)
            return {"status": "COMMITTED", "receipt": receipt}

        try:
            if row.get("submission"):
                # Previous human continuation already produced a validated proposal.
                # Recheck current business state atomically rather than spend model/tool
                # budget regenerating an identical commit after a network failure.
                previous_submission = row["submission"]
                return await submit(
                    {**previous_submission, **lease, "proposal": {**previous_submission["proposal"], "fence": fence}}
                )
            if row["elapsed"] >= 120:
                raise Halt("BUDGET")
            async with connect(self.mcp_url, self.capability) as session:
                async with AsyncPostgresSaver.from_conn_string(self.store.url) as saver:
                    workflow = Workflow(
                        original, self.model, McpTools(session), trace, seconds=120 - row["elapsed"], reserve=reserve
                    )
                    workflow.model_calls = row["models"]
                    workflow.tool_calls = row["tools"]
                    result = await workflow.run(
                        FencedSaver(saver, self.store, command.runId, owner),
                        continuation=command.action == "RESUME",
                        expect_checkpoint=bool(row["models"] or row["tools"]),
                    )
            if result["status"] == "PROPOSAL_ACCEPTABLE":
                proposal = {**result["proposal"], "fence": fence}
                submission = {
                    **lease,
                    "commandId": original.commandId,
                    "proposal": proposal,
                    "classification": result["classification"],
                    "provider": "mock" if self.model.id.startswith("mock") else "gemini",
                    "model": self.model.id,
                    "promptVersion": "agent-prompt-v1",
                    "retrievalQuery": next(
                        (
                            o["arguments"]["query"]
                            for o in reversed(result.get("observations", []))
                            if o["name"] == "Search"
                            and any(
                                s["revisionId"] == (proposal.get("source") or {}).get("revisionId")
                                for s in o["result"]["sources"]
                            )
                        ),
                        None,
                    ),
                }
                return await submit(submission)
            if result["status"] == "WAITING_FOR_HUMAN" and result["code"] == "OK":
                await self.bridge.call("CONTROL", {**lease, "action": "PAUSE"})
                await self.store.finish(command.runId, owner, "WAITING_FOR_HUMAN", result)
                return {**result, "revision": claimed["revision"] + 1}
            await self.bridge.call("CONTROL", {**lease, "action": "STALE" if result["status"] == "STALE" else "FAIL"})
            await self.store.finish(command.runId, owner, result["status"], result)
            return result
        except asyncio.CancelledError:
            with suppress(Exception):
                await self.store.finish(command.runId, owner, "FAILED", {"code": "LEASE_LOST"})
            return {"status": "FAILED", "code": "LEASE_LOST"}
        except Exception as error:
            code = getattr(error, "code", "CHECKPOINT_UNAVAILABLE")
            with suppress(Exception):
                await self.bridge.call("CONTROL", {**lease, "action": "STALE" if code == "STALE" else "FAIL"})
            await self.store.finish(command.runId, owner, "STALE" if code == "STALE" else "FAILED", {"code": code})
            return {"status": "STALE" if code == "STALE" else "FAILED", "code": code}
        finally:
            beat.cancel()
            with suppress(asyncio.CancelledError):
                await beat
