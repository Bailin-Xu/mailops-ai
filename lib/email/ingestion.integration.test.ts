import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { ingestEml } from "@/lib/email/ingestion";

const db = getDb();
const createdThreadIds = new Set<string>();
const fixturesDirectory = resolve("tests/fixtures/eml");

afterEach(async () => {
  if (createdThreadIds.size === 0) return;

  const threadIds = [...createdThreadIds];
  await db.emailMessage.deleteMany({ where: { threadId: { in: threadIds } } });
  await db.emailThread.deleteMany({ where: { id: { in: threadIds } } });
  createdThreadIds.clear();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("ingestEml", () => {
  it("imports one complete message graph in a transaction", async () => {
    const input = await fixture("attachment.eml");
    const result = await ingestEml(input, "attachment.eml", {
      db,
      ownedAddresses: ["support@example.test"],
    });

    expect(result.status).toBe("imported");
    if (result.status !== "imported") return;
    createdThreadIds.add(result.threadId);

    const stored = await db.emailMessage.findUnique({
      where: { id: result.messageId },
      include: { thread: true, participants: true, attachments: true },
    });

    expect(stored).toMatchObject({
      messageId: "attachment-001@example.test",
      subject: "File metadata",
      direction: "INBOUND",
      knowledgeSourceStatus: "EXCLUDED",
      knowledgeExclusionReasons: expect.arrayContaining([
        "DIRECTION_NOT_OUTBOUND",
        "MISSING_CONTEXT",
      ]),
      thread: {
        subject: "File metadata",
        normalizedSubject: "file metadata",
        isIncomplete: false,
      },
    });
    expect(stored?.participants).toHaveLength(2);
    expect(stored?.attachments).toEqual([
      expect.objectContaining({
        fileName: "example.txt",
        mimeType: "text/plain",
        sizeBytes: 11,
      }),
    ]);
  });

  it("returns the existing record for a duplicate Message-ID", async () => {
    const input = await fixture("english-text.eml");
    const first = await ingestEml(input, "english-text.eml", { db });
    expect(first.status).toBe("imported");
    if (first.status !== "imported") return;
    createdThreadIds.add(first.threadId);

    const second = await ingestEml(input, "renamed-copy.eml", { db });

    expect(second).toEqual({
      status: "duplicate",
      existingMessageId: first.messageId,
      threadId: first.threadId,
      matchedBy: "MESSAGE_ID",
    });
    await expect(db.emailMessage.count({ where: { threadId: first.threadId } })).resolves.toBe(1);
  });

  it("uses the fingerprint when Message-ID is missing", async () => {
    const input = Buffer.from(
      [
        "From: Sender <sender@example.test>",
        "To: Support <support@example.test>",
        "Subject: No message identifier",
        "Date: Tue, 11 Aug 2026 10:00:00 +0000",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        "The same deterministic content.",
      ].join("\r\n"),
    );

    const first = await ingestEml(input, "missing-id.eml", { db });
    expect(first.status).toBe("imported");
    if (first.status !== "imported") return;
    createdThreadIds.add(first.threadId);

    const second = await ingestEml(input, "missing-id-copy.eml", { db });
    expect(second).toEqual({
      status: "duplicate",
      existingMessageId: first.messageId,
      threadId: first.threadId,
      matchedBy: "FINGERPRINT",
    });
  });

  it("returns a parser failure without writing partial records", async () => {
    const transaction = vi.spyOn(db, "$transaction");

    const result = await ingestEml(Buffer.alloc(0), "empty.eml", { db });

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "EMPTY_FILE" },
    });
    expect(transaction).not.toHaveBeenCalled();
    transaction.mockRestore();
  });
});

function fixture(fileName: string) {
  return readFile(resolve(fixturesDirectory, fileName));
}
