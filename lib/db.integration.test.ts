import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getDb } from "./db";

const db = getDb();
let testThreadId: string | undefined;

afterEach(async () => {
  if (testThreadId) {
    await db.emailMessage.deleteMany({ where: { threadId: testThreadId } });
    await db.emailThread.delete({ where: { id: testThreadId } });
    testThreadId = undefined;
  }
});

afterAll(async () => {
  await db.$disconnect();
});

describe("email persistence", () => {
  it("stores a message in its thread and rejects a duplicate Message-ID", async () => {
    const testId = randomUUID();
    const messageId = `<${testId}@mailops.test>`;

    const thread = await db.emailThread.create({
      data: {
        subject: "Question about opening hours",
        normalizedSubject: "question about opening hours",
        messages: {
          create: {
            messageId,
            subject: "Question about opening hours",
            sentAt: new Date("2026-01-15T14:30:00.000Z"),
            textBody: "Bonjour, êtes-vous ouverts samedi ?",
            normalizedBody: "Bonjour, êtes-vous ouverts samedi ?",
            sourceFileName: "opening-hours.eml",
            fingerprint: `sha256:${testId}`,
          },
        },
      },
      include: { messages: true },
    });

    testThreadId = thread.id;

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      threadId: thread.id,
      messageId,
      textBody: "Bonjour, êtes-vous ouverts samedi ?",
    });

    await expect(
      db.emailMessage.create({
        data: {
          threadId: thread.id,
          messageId,
          subject: "Duplicate",
          normalizedBody: "Duplicate",
          sourceFileName: "duplicate.eml",
          fingerprint: `sha256:${randomUUID()}`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
