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
  it("persists the complete message graph and enforces its constraints", async () => {
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
            participants: {
              create: [
                {
                  type: "FROM",
                  displayName: "Élise Exemple",
                  emailAddress: "Elise@Example.test",
                  normalizedAddress: "elise@example.test",
                },
                {
                  type: "TO",
                  displayName: "Support",
                  emailAddress: "support@example.test",
                  normalizedAddress: "support@example.test",
                },
              ],
            },
            attachments: {
              create: {
                fileName: "details.txt",
                mimeType: "text/plain",
                sizeBytes: 128,
                contentId: null,
                isInline: false,
              },
            },
          },
        },
      },
      include: {
        messages: {
          include: {
            participants: true,
            attachments: true,
          },
        },
      },
    });

    testThreadId = thread.id;

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      threadId: thread.id,
      messageId,
      textBody: "Bonjour, êtes-vous ouverts samedi ?",
    });
    expect(thread.messages[0]?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "FROM",
          displayName: "Élise Exemple",
          normalizedAddress: "elise@example.test",
        }),
        expect.objectContaining({
          type: "TO",
          normalizedAddress: "support@example.test",
        }),
      ]),
    );
    expect(thread.messages[0]?.attachments).toEqual([
      expect.objectContaining({
        fileName: "details.txt",
        mimeType: "text/plain",
        sizeBytes: 128,
        isInline: false,
      }),
    ]);
    expect(thread.messages[0]?.attachments[0]).not.toHaveProperty("content");

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

    await expect(
      db.emailThread.delete({ where: { id: thread.id } }),
    ).rejects.toMatchObject({ code: "P2003" });

    const storedMessageId = thread.messages[0]?.id;
    expect(storedMessageId).toBeDefined();
    if (!storedMessageId) return;

    await db.emailMessage.delete({ where: { id: storedMessageId } });

    await expect(
      Promise.all([
        db.emailParticipant.count({ where: { messageId: storedMessageId } }),
        db.attachmentMetadata.count({ where: { messageId: storedMessageId } }),
      ]),
    ).resolves.toEqual([0, 0]);
  });
});
