import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { expect, it } from "vitest";

import { resolveTestDatabaseUrl } from "./support/database-target.mjs";

const migrationName = "20261027190000_add_knowledge_revisions_and_evidence";

it("upgrades real pre-phase-2 schema/data without inventing old draft evidence, and supports transaction rollback", async () => {
  const safeUrl = resolveTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    DATABASE_URL: process.env.MAILOPS_TEST_DEVELOPMENT_DATABASE_URL });
  const scratchName = `mailops_migration_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: safeUrl });
  const scratchUrl = new URL(safeUrl); scratchUrl.pathname = `/${scratchName}`;
  const client = new Client({ connectionString: scratchUrl.toString() });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratchName}"`); created = true;
    await client.connect();
    const migrations = (await readdir(resolve("prisma/migrations"))).filter((name) => name < migrationName).sort();
    for (const name of migrations) {
      await client.query(await readFile(resolve("prisma/migrations", name, "migration.sql"), "utf8"));
    }
    const ids = Object.fromEntries(["thread", "message", "execution", "classification", "candidate", "entry", "pending", "sent"].map((key) => [key, randomUUID()]));
    await client.query('INSERT INTO "EmailThread" ("id", "subject", "normalizedSubject", "updatedAt") VALUES ($1, \'Synthetic historical thread\', \'synthetic\', NOW())', [ids.thread]);
    await client.query('INSERT INTO "EmailMessage" ("id", "threadId", "subject", "normalizedBody", "sourceFileName", "fingerprint") VALUES ($1,$2,\'Synthetic\',\'Original text\',\'synthetic-migration.eml\',$3)', [ids.message, ids.thread, ids.message]);
    await client.query('INSERT INTO "AIExecution" ("id", "taskType", "provider", "model", "promptVersion", "status", "latencyMs", "inputMetadata") VALUES ($1,\'CLASSIFICATION\',\'mock\',\'synthetic\',\'v1\',\'SUCCEEDED\',1,\'{}\')', [ids.execution]);
    await client.query('INSERT INTO "Classification" ("id", "threadId", "aiExecutionId", "aiCategory", "aiConfidence", "aiLanguage") VALUES ($1,$2,$3,\'KNOWN_QUESTION\',0.9,\'en\')', [ids.classification, ids.thread, ids.execution]);
    await client.query('INSERT INTO "KnowledgeCandidate" ("id", "fingerprint", "title", "canonicalQuestion", "proposedAnswer", "category", "language", "status", "updatedAt") VALUES ($1,$2,\'Synthetic policy\',\'A historical question?\',\'Current approved answer\',\'TEST\',\'en\',\'APPROVED\',NOW())', [ids.candidate, ids.candidate]);
    await client.query('INSERT INTO "KnowledgeEntry" ("id", "sourceCandidateId", "title", "canonicalQuestion", "answer", "category", "language", "approvedAt", "updatedAt") VALUES ($1,$2,\'Synthetic policy\',\'A historical question?\',\'Current approved answer\',\'TEST\',\'en\',\'2020-01-01\',NOW())', [ids.entry, ids.candidate]);
    for (const [id, status] of [[ids.pending, "GENERATED"], [ids.sent, "SIMULATED_SENT"]]) {
      await client.query('INSERT INTO "Draft" ("id", "threadId", "classificationId", "subject", "body", "language", "style", "mode", "status", "approvedBody", "approvedLanguage", "updatedAt") VALUES ($1,$2,$3,\'Original subject\',\'Original generated text\',\'en\',\'synthetic\',\'MOCK_GROUNDED\',$4::"DraftStatus",$5,$6,NOW())',
        [id, ids.thread, ids.classification, status, status === "SIMULATED_SENT" ? "Exact historical approved text" : null, status === "SIMULATED_SENT" ? "fr" : null]);
      await client.query('INSERT INTO "DraftKnowledgeSource" ("draftId", "knowledgeEntryId", "rank", "relevanceScore", "knowledgeFingerprint") VALUES ($1,$2,1,0.9,\'old-validity-token\')', [id, ids.entry]);
    }
    const oldDrafts = () => client.query('SELECT "id", "threadId", "classificationId", "subject", "body", "status", "approvedBody", "approvedLanguage" FROM "Draft" ORDER BY "id"');
    const before = (await oldDrafts()).rows;
    const sql = await readFile(resolve("prisma/migrations", migrationName, "migration.sql"), "utf8");
    await client.query("BEGIN"); await client.query(sql); await client.query("ROLLBACK");
    expect((await client.query('SELECT to_regclass(\'public."KnowledgeRevision"\') AS relation')).rows[0].relation).toBeNull();
    expect((await oldDrafts()).rows).toEqual(before);

    await client.query("BEGIN"); await client.query(sql); await client.query("COMMIT");
    expect((await oldDrafts()).rows).toEqual(before);
    const revision = (await client.query('SELECT * FROM "KnowledgeRevision" WHERE "knowledgeEntryId" = $1', [ids.entry])).rows[0];
    expect(revision).toMatchObject({ version: 1, answer: "Current approved answer", origin: "LEGACY_BASELINE", reviewEventId: null });
    expect(revision.recordedAt.getTime()).toBeGreaterThan(revision.approvedAt.getTime());
    const entry = (await client.query('SELECT * FROM "KnowledgeEntry" WHERE "id" = $1', [ids.entry])).rows[0];
    expect(entry).toMatchObject({ currentRevisionId: revision.id, revisionSequence: 1, answer: "Current approved answer" });
    const sources = (await client.query('SELECT * FROM "DraftKnowledgeSource"')).rows;
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.knowledgeRevisionId === null && source.knowledgeEntryId === ids.entry)).toBe(true);
    const drafts = (await client.query('SELECT * FROM "Draft"')).rows;
    expect(drafts.every((draft) => draft.evidenceStatus === "LEGACY_UNVERIFIED" && draft.inputSnapshot === null)).toBe(true);
    expect(drafts.find((draft) => draft.id === ids.pending)).toMatchObject({ knowledgeReviewReason: "LEGACY_EVIDENCE_UNVERIFIED" });
    expect(drafts.find((draft) => draft.id === ids.sent)).toMatchObject({ knowledgeReviewRequiredAt: null, approvedBody: "Exact historical approved text" });
    expect((await client.query('SELECT "threadId" FROM "EmailMessage" WHERE "id" = $1', [ids.message])).rows[0].threadId).toBe(ids.thread);
  } finally {
    await client.end();
    if (created) await admin.query(`DROP DATABASE "${scratchName}" WITH (FORCE)`);
    await admin.end();
  }
}, 30_000);
