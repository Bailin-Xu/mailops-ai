"""Explicitly initialized, isolated PostgreSQL runtime control and checkpoint store."""

from pathlib import Path
import hashlib
import json
from typing import Any
from urllib.parse import urlparse
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class RuntimeConflict(Exception):
    pass


def checkpoint_url(raw: str) -> str:
    u = urlparse(raw)
    if (
        u.scheme != "postgresql"
        or u.hostname != "127.0.0.1"
        or u.port != 5436
        or u.path != "/mailops_agent_checkpoint"
        or u.username != "mailops_agent_checkpoint"
        or u.query
        or u.fragment
    ):
        raise ValueError("Explicit isolated checkpoint database required")
    return raw


class Store:
    def __init__(self, url: str):
        self.url = checkpoint_url(url)

    async def connection(self):
        return await psycopg.AsyncConnection.connect(
            self.url, autocommit=True, row_factory=dict_row, connect_timeout=3, options="-c statement_timeout=3000"
        )

    async def get(self, run_id: str):
        async with await self.connection() as db:
            row = await (await db.execute("SELECT * FROM agent_runtime_a3 WHERE run_id=%s", (run_id,))).fetchone()
            if row is None:
                raise RuntimeConflict("RUN_NOT_FOUND")
            return row

    async def claim(self, command: Any, owner: str, model_id: str):
        immutable = {
            "context": command.context.model_dump(),
            "versions": [command.graphVersion, command.policyVersion, command.promptVersion],
            "model": model_id,
            "code": hashlib.sha256(
                b"".join(
                    (Path(__file__).parent / name).read_bytes()
                    for name in [
                        "workflow.py",
                        "models.py",
                        "decisions.py",
                        "requirements.lock",
                        "runtime.py",
                        "store.py",
                        "checkpoints.py",
                        "contracts.py",
                        "mcp_client.py",
                        "bridge.py",
                    ]
                )
            ).hexdigest(),
        }
        fingerprint = hashlib.sha256(json.dumps(immutable, sort_keys=True).encode()).hexdigest()
        async with await self.connection() as db:
            async with db.transaction():
                row = await (
                    await db.execute(
                        "SELECT *, lease_until>now() AS busy FROM agent_runtime_a3 WHERE run_id=%s FOR UPDATE",
                        (command.runId,),
                    )
                ).fetchone()
                if row is None:
                    if command.action != "START":
                        raise RuntimeConflict("RUN_NOT_FOUND")
                    await db.execute(
                        "INSERT INTO agent_runtime_a3(run_id,config_hash,command) VALUES (%s,%s,%s)",
                        (command.runId, fingerprint, Jsonb(command.model_dump())),
                    )
                else:
                    if (
                        row["config_hash"] != fingerprint
                        or row["busy"]
                        or row["status"] in ["COMMITTED", "CANCELLED", "STALE"]
                    ):
                        raise RuntimeConflict("RUN_CONFLICT")
                    if row["status"] == "WAITING_FOR_HUMAN" and (row["result"] or {}).get("code") != "OK":
                        raise RuntimeConflict("HUMAN_ACTION_REQUIRED")
                    if command.action == "START" or (row["status"] == "WAITING_FOR_HUMAN" and row["resumes"] >= 3):
                        raise RuntimeConflict("RUN_CONFLICT")
                    if row["status"] == "FAILED" and (row["result"] or {}).get("code") not in [
                        "PROVIDER_ERROR",
                        "TIMEOUT",
                        "MCP_UNAVAILABLE",
                        "COMMIT_UNKNOWN",
                        "CHECKPOINT_UNAVAILABLE",
                        "CONFLICT",
                        "BUSINESS_CONFLICT",
                    ]:
                        raise RuntimeConflict("NONRETRYABLE")
                return await (
                    await db.execute(
                        """UPDATE agent_runtime_a3 SET owner=%s, lease_until=now()+interval '30 seconds',
                  elapsed=elapsed+coalesce(extract(epoch from now()-active_started),0),active_started=now(),status='RUNNING',
                  resumes=resumes+CASE WHEN status='WAITING_FOR_HUMAN' THEN 1 ELSE 0 END
                  WHERE run_id=%s RETURNING *""",
                        (owner, command.runId),
                    )
                ).fetchone()

    async def heartbeat(self, run_id, owner):
        async with await self.connection() as db:
            result = await db.execute(
                "UPDATE agent_runtime_a3 SET lease_until=now()+interval '30 seconds' WHERE run_id=%s AND owner=%s AND status='RUNNING' AND lease_until>now()",
                (run_id, owner),
            )
            if result.rowcount != 1:
                raise RuntimeConflict("LEASE_LOST")

    async def reserve(self, run_id, owner, kind):
        column = "models" if kind == "model" else "tools"
        limit = 6 if kind == "model" else 8
        async with await self.connection() as db:
            row = await (
                await db.execute(
                    f"""UPDATE agent_runtime_a3 SET {column}={column}+1
             WHERE run_id=%s AND owner=%s AND lease_until>now() AND status='RUNNING' AND {column}<%s
             AND elapsed+extract(epoch from now()-active_started)<120 RETURNING models,tools""",
                    (run_id, owner, limit),
                )
            ).fetchone()
            if row is None:
                raise RuntimeConflict("BUDGET_OR_LEASE")
            return row

    async def finish(self, run_id, owner, status, result):
        async with await self.connection() as db:
            row = await db.execute(
                """UPDATE agent_runtime_a3 SET status=%s,result=%s,
             elapsed=elapsed+coalesce(extract(epoch from now()-active_started),0),active_started=null,lease_until=null
             WHERE run_id=%s AND owner=%s AND status='RUNNING' """,
                (status, Jsonb(result), run_id, owner),
            )
            if row.rowcount != 1:
                raise RuntimeConflict("LEASE_LOST")

    async def save_submission(self, run_id, owner, payload):
        async with await self.connection() as db:
            result = await db.execute(
                "UPDATE agent_runtime_a3 SET submission=%s WHERE run_id=%s AND owner=%s AND lease_until>now() AND status='RUNNING'",
                (Jsonb(payload), run_id, owner),
            )
            if result.rowcount != 1:
                raise RuntimeConflict("LEASE_LOST")

    async def cancel(self, run_id):
        async with await self.connection() as db:
            await db.execute(
                "UPDATE agent_runtime_a3 SET status='CANCELLED',lease_until=null,active_started=null WHERE run_id=%s AND status!='COMMITTED'",
                (run_id,),
            )


async def setup(url: str):
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    store = Store(url)
    async with await store.connection() as db:
        await db.execute("""CREATE TABLE IF NOT EXISTS agent_runtime_a3(
          run_id uuid PRIMARY KEY,config_hash text NOT NULL,command jsonb NOT NULL,status text NOT NULL DEFAULT 'READY',
          owner uuid,lease_until timestamptz,active_started timestamptz,elapsed double precision NOT NULL DEFAULT 0,
          models integer NOT NULL DEFAULT 0,tools integer NOT NULL DEFAULT 0,resumes integer NOT NULL DEFAULT 0,
          result jsonb,submission jsonb)""")
    async with AsyncPostgresSaver.from_conn_string(store.url) as saver:
        await saver.setup()


if __name__ == "__main__":
    import asyncio
    import os

    asyncio.run(setup(os.environ["AGENT_CHECKPOINT_DATABASE_URL"]))
