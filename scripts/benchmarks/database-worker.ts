import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { resolveTestDatabaseUrl } from "../../tests/support/database-target.mjs";
import { generateThreadCorpus, corpusUuid, shuffled, expectedCorpusGroups } from "../../lib/benchmarks/thread-corpus";
import { prepareThreadReconstruction } from "../../lib/email/reconstruction/plan";
import { applyThreadReconstruction } from "../../lib/email/reconstruction/apply";
import { getMockInboxQueue, parseInboxFilters } from "../../lib/inbox/queue";
import { searchActiveKnowledge, buildKnowledgeSearchQuery } from "../../lib/knowledge/search";
import { sourceContextHash } from "../../lib/workflow/context";
const { values } = parseArgs({ options: { size: { type: "string", default: "1000" }, repetitions: { type: "string", default: "3" } } });
const size = Number(values.size), repetitions = Number(values.repetitions);
const messages = generateThreadCorpus(size);
const fields = { title: "Synthetic shipping", canonicalQuestion: "How does synthetic shipping work?", answer: "Tracked shipping is available.", category: "SHIPPING", language: "en" };
const chunks = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / 1000) }, (_, i) => items.slice(i * 1000, (i + 1) * 1000));
async function seed(db: PrismaClient) {
  // Only called on the scratch database created and owned by this process.
  await db.$executeRawUnsafe('TRUNCATE "EmailThread", "KnowledgeCandidate", "AIExecution", "AuditEvent" CASCADE');
  for (const batch of chunks(shuffled(messages))) {
    await db.emailThread.createMany({ data: batch.map((m) => ({ id: m.threadId, subject: "Synthetic inquiry", normalizedSubject: "synthetic inquiry", isIncomplete: Boolean(m.inReplyTo || m.references.length), createdAt: m.sentAt! })) });
    await db.emailMessage.createMany({ data: batch.map((m) => {
      const i = parseInt(m.id.slice(-12), 16) - 1;
      const body = `Synthetic réponse conservée ${i}. ${i % 1000 === 0 ? "corpusneedle " : ""}`.padEnd(512, "x");
      return { ...m, originalThreadId: m.threadId, subject: "Synthetic inquiry", sourceFileName: "synthetic-scale.eml", fingerprint: m.fingerprint!,
        direction: i % 3 === 1 ? "OUTBOUND" as const : "INBOUND" as const, normalizedBody: body, cleanBody: body };
    }) });
    await db.emailParticipant.createMany({ data: batch.map((m) => ({ id: corpusUuid(6, parseInt(m.id.slice(-12), 16)), messageId: m.id, type: "FROM" as const,
      emailAddress: "synthetic@example.test", normalizedAddress: "synthetic@example.test", displayName: "Synthetic reader" })) });
  }
  const classified = messages.filter((m, i) => i % 10 === 0 && i % 3 !== 1);
  for (const batch of chunks(classified)) {
    await db.aIExecution.createMany({ data: batch.map((m) => ({ id: corpusUuid(3, parseInt(m.id.slice(-12), 16)), taskType: "CLASSIFICATION", provider: "synthetic-benchmark", model: "no-model-call", promptVersion: "fixture-v1", status: "SUCCEEDED" as const, latencyMs: 0, inputMetadata: {} })) });
    await db.classification.createMany({ data: batch.map((m) => {
      const i = parseInt(m.id.slice(-12), 16) - 1;
      const body = `Synthetic réponse conservée ${i}. ${i % 1000 === 0 ? "corpusneedle " : ""}`.padEnd(512, "x");
      return { id: corpusUuid(4, i + 1), threadId: m.threadId, aiExecutionId: corpusUuid(3, i + 1), aiCategory: "MANUAL_REVIEW" as const,
        aiConfidence: .5, aiLanguage: "en", processingStatus: "WAITING_FOR_REVIEW" as const, threadRevision: 0,
        sourceContextHash: sourceContextHash({ id: m.threadId, subject: "Synthetic inquiry", messages: [{ id: m.id, sentAt: m.sentAt, cleanBody: body, normalizedBody: body }] }) };
    }) });
  }
  const knowledgeCount = Math.min(5000, size / 10);
  const knowledge = Array.from({ length: knowledgeCount }, (_, i) => ({ ...fields, title: `benchk${i} shipping`,
    canonicalQuestion: `How does benchk${i} tracked shipping work?`, answer: `Tracked shipping for benchk${i} is available.`, id: i + 1 }));
  for (const batch of chunks(knowledge)) {
    await db.knowledgeCandidate.createMany({ data: batch.map((k) => ({ category: fields.category, language: fields.language, id: corpusUuid(7, k.id), fingerprint: `synthetic-knowledge-${k.id}`, title: k.title, canonicalQuestion: k.canonicalQuestion, proposedAnswer: k.answer, status: "APPROVED" as const })) });
    await db.knowledgeEntry.createMany({ data: batch.map((k) => ({ ...fields, id: corpusUuid(8, k.id), sourceCandidateId: corpusUuid(7, k.id), title: k.title, canonicalQuestion: k.canonicalQuestion, answer: k.answer, approvedAt: new Date("2026-01-01"), revisionSequence: 1 })) });
    await db.knowledgeRevision.createMany({ data: batch.map((k) => ({ ...fields, id: corpusUuid(9, k.id), knowledgeEntryId: corpusUuid(8, k.id), title: k.title, canonicalQuestion: k.canonicalQuestion, answer: k.answer, version: 1, approvedAt: new Date("2026-01-01"), origin: "SYNTHETIC_FIXTURE" as const })) });
  }
  await db.$executeRaw`UPDATE "KnowledgeEntry" e SET "currentRevisionId" = r.id FROM "KnowledgeRevision" r WHERE r."knowledgeEntryId" = e.id`;
  for (const table of ["EmailThread", "EmailMessage", "Classification", "EmailParticipant", "KnowledgeEntry"]) await db.$executeRawUnsafe(`ANALYZE "${table}"`);
  return knowledgeCount;
}
async function measureQueries(db: PrismaClient) {
  const results: Record<string, unknown> = {};
  const operations = {
    inboxFirst: () => getMockInboxQueue(parseInboxFilters({}), db),
    inboxFiltered: () => getMockInboxQueue(parseInboxFilters({ q: "corpusneedle" }), db),
    inboxLast: () => getMockInboxQueue(parseInboxFilters({ page: "100000" }), db),
    retrievalSpecific: () => searchActiveKnowledge({ q: "benchk42", language: "en", limit: 8 }, db),
    retrievalBroad: () => searchActiveKnowledge({ q: "shipping", language: "en", limit: 8 }, db),
  };
  for (const [name, operation] of Object.entries(operations)) {
    await operation(); // Explicit warm-up; caches are not flushed or advertised as cold.
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const started = performance.now(), output = await operation();
      const elapsedMs = performance.now() - started;
      const rows = Array.isArray(output) ? output.length : output.items.length;
      if (rows > (name.startsWith("inbox") ? 10 : 8)) throw new Error("Unbounded benchmark response.");
      samples.push({ elapsedMs, rows, responseBytes: Buffer.byteLength(JSON.stringify(output)), ...(!Array.isArray(output) ? { total: output.pagination.total, selectedMessages: output.selected?.messages.length ?? 0 } : {}) });
    }
    results[name] = samples;
  }
  const query = buildKnowledgeSearchQuery({ q: "benchk42", language: "en", limit: 8 });
  const explain = await db.$queryRawUnsafe<Array<Record<string, unknown>>>('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.text, ...query.values);
  results.retrievalExplain = explain[0]["QUERY PLAN"];
  return results;
}
async function main() {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw new Error("Unsupported repetition count.");
  const testUrl = resolveTestDatabaseUrl(process.env), scratch = `mailops_bench_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: testUrl }); const scratchUrl = new URL(testUrl); scratchUrl.pathname = `/${scratch}`;
  let created = false, db: PrismaClient | undefined;
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE "${scratch}"`); created = true;
    const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: scratchUrl.toString() } });
    if (migration.status !== 0) throw new Error("Scratch migration failed.");
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl.toString(), max: 2 }) });
    const [settings] = await db.$queryRaw<Array<Record<string, string>>>`SELECT version() AS version, current_setting('shared_buffers') AS shared_buffers, current_setting('work_mem') AS work_mem`;
    const samples = [];
    for (let i = 0; i < repetitions; i++) {
      const knowledgeCount = await seed(db);
      const beforeQueries = await measureQueries(db);
      await prepareThreadReconstruction(db); // Warm metadata/data scans, no writes.
      global.gc?.(); const heapBefore = process.memoryUsage().heapUsed;
      let started = performance.now(); const plan = await prepareThreadReconstruction(db); const planMs = performance.now() - started;
      started = performance.now(); const applied = await applyThreadReconstruction(plan, db); const applyMs = performance.now() - started;
      const heapAfterApply = process.memoryUsage().heapUsed;
      const actual = await db.emailMessage.findMany({ select: { id: true, threadId: true }, orderBy: { id: "asc" } });
      const groups = new Map<string, string[]>();
      for (const row of actual) { const ids = groups.get(row.threadId) ?? []; ids.push(row.id); groups.set(row.threadId, ids); }
      const normalized = [...groups.values()].map((ids) => ids.sort()).sort((a, b) => a[0].localeCompare(b[0]));
      if (JSON.stringify(normalized) !== JSON.stringify(expectedCorpusGroups(size))) throw new Error("Database membership differs from generated truth.");
      const replay = await applyThreadReconstruction(plan, db);
      if (replay.status !== "ALREADY_APPLIED" || applied.movedMessages !== size * .9) throw new Error("Apply/replay invariant failed.");
      const afterQueries = await measureQueries(db);
      samples.push({ planMs, applyMs, heapBeforeBytes: heapBefore, heapAfterApplyBytes: heapAfterApply, heapDeltaBytes: heapAfterApply - heapBefore,
        maxRssBytes: process.resourceUsage().maxRSS * 1024, knowledgeCount, membershipCorrect: true, replay: replay.status, applied, beforeQueries, afterQueries });
    }
    console.log(JSON.stringify({ status: "COMPLETED", size, repetitions, settings, samples, maxRssBytes: process.resourceUsage().maxRSS * 1024 }));
  } finally {
    await db?.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${scratch}" WITH (FORCE)`);
    await admin.end();
  }
}
void main().catch(() => { console.error("Synthetic database benchmark failed; no development data was used. Check isolated service/resources."); process.exitCode = 1; });
