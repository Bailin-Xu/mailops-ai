"""Fence checkpoint writes while holding the runtime admission row lock."""

from contextlib import asynccontextmanager
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from store import RuntimeConflict


class FencedSaver(AsyncPostgresSaver):
    def __init__(self, base, store, run_id, owner):
        super().__init__(base.conn, serde=base.serde)
        self.store, self.run_id, self.owner = store, run_id, owner

    @asynccontextmanager
    async def guard(self):
        async with await self.store.connection() as db:
            async with db.transaction():
                row = await (
                    await db.execute(
                        "SELECT owner::text,status,lease_until>now() AS live FROM agent_runtime_a3 WHERE run_id=%s FOR UPDATE",
                        (self.run_id,),
                    )
                ).fetchone()
                if not row or row["owner"] != self.owner or row["status"] != "RUNNING" or not row["live"]:
                    raise RuntimeConflict("LEASE_LOST")
                yield

    async def aput(self, config, checkpoint, metadata, new_versions):
        async with self.guard():
            return await super().aput(config, checkpoint, metadata, new_versions)

    async def aput_writes(self, config, writes, task_id, task_path=""):
        async with self.guard():
            await super().aput_writes(config, writes, task_id, task_path)
