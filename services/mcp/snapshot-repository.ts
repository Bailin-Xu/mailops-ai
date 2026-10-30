import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { snapshotRetriever } from "../../lib/evaluation/benchmark/retrieval";
import { agentTarget } from "../../scripts/agent/target";
import type { ToolRepository, Source } from "./tools";
import dataset from "../../contracts/agent/dataset.json";
export async function snapshotRepository(url: string, caseId: string, scope: "family" | "corpus" = "family") {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: agentTarget(url), connectionTimeoutMillis: 1000, statement_timeout: 1000, query_timeout: 1500 }) });
  const selected = dataset.cases.find(c => c.id === caseId);
  if (!selected) throw new Error("Unknown synthetic case");
  // A1 serves only a scoped synthetic family; never falls back to application tables.
  async function snapshot(signal: AbortSignal) {
    signal.throwIfAborted();
    const rows = await db.$queryRawUnsafe<Array<{payload: typeof dataset}>>("SELECT payload FROM agent_a0_fixtures.snapshot WHERE id='agent-synthetic-v1'");
    signal.throwIfAborted();
    if (!rows[0]) throw new Error("Missing snapshot");
    return rows[0].payload;
  }
  function source(row: typeof dataset.knowledge[number]): Source { return { ...row, language: row.language as "en" | "fr" }; }
  const repository: ToolRepository = {
    async thread(id, signal) {
      const data = await snapshot(signal);
      const c = data.cases.find(c => c.id === caseId);
      if (!c || id !== data.knowledge.find(k => k.family === c.family && k.language === c.language)?.id) return null;
      return { id, subject: c.subject, body: c.body, language: c.language as "en" | "fr" };
    },
    async search(query, language, limit, signal) {
      const data = await snapshot(signal);
      const knowledge = data.knowledge.filter(k => (scope === "corpus" || k.family === selected.family)).map(k => ({ ...k,
        language: k.language as "en" | "fr", category: "KNOWN_QUESTION", canonicalQuestion: k.title, approvedAt: "2026-10-29T00:00:00.000Z", version: 1,
        status: k.status as "ACTIVE" | "INACTIVE" }));
      const matches = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1000ms'");
        return snapshotRetriever(tx)({ q: query, language, limit, category: "" }, knowledge);
      });
      signal.throwIfAborted();
      return matches.map(m => source(knowledge.find(k => k.id === m.id)!));
    },
    async revision(id, signal) {
      const data = await snapshot(signal);
      const row = data.knowledge.find(k => (scope === "corpus" || k.family === selected.family) && k.revisionId === id);
      return row ? source(row) : null;
    },
  };
  return { repository, threadId: dataset.knowledge.find(k => k.family === selected.family && k.language === selected.language)!.id, close: () => db.$disconnect() };
}
