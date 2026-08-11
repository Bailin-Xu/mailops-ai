import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseEml } from "@/lib/email/parser";

const fixturesDirectory = resolve("tests/fixtures/eml");

async function parseFixture(fileName: string) {
  const input = await readFile(resolve(fixturesDirectory, fileName));
  return parseEml(input, fileName);
}

describe("parseEml", () => {
  it("parses headers, participants, references, and plain text", async () => {
    const result = await parseFixture("english-text.eml");

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.email).toMatchObject({
      messageId: "english-001@example.test",
      inReplyTo: "parent-001@example.test",
      references: ["root-001@example.test", "parent-001@example.test"],
      subject: "Opening hours",
      parseStatus: "PARSED",
      sourceFileName: "english-text.eml",
    });
    expect(result.email.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "FROM", normalizedAddress: "alice@example.test" }),
        expect.objectContaining({ type: "TO", normalizedAddress: "support@example.test" }),
      ]),
    );
    expect(result.email.normalizedBody).toContain("Are you open on Saturday?");
    expect(result.email.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves French characters", async () => {
    const result = await parseFixture("french-text.eml");

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.email.subject).toBe("Modalités d’inscription");
    expect(result.email.normalizedBody).toBe(
      "Bonjour, j’aimerais connaître les modalités d’inscription.",
    );
    expect(result.email.participants[0]?.displayName).toBe("Élise Exemple");
  });

  it("creates readable text from HTML without loading remote content", async () => {
    const result = await parseFixture("html-only.eml");

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.email.normalizedBody).toBe("Hello support.");
    expect(result.email.parseWarnings).toContain("HTML_ONLY_BODY");
    expect(result.email.normalizedBody).not.toContain("tracker.invalid");
    expect(result.email.normalizedBody).not.toContain("doNotRun");
  });

  it("keeps attachment metadata without attachment content", async () => {
    const result = await parseFixture("attachment.eml");

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.email.attachments).toEqual([
      {
        fileName: "example.txt",
        mimeType: "text/plain",
        sizeBytes: 11,
        contentId: null,
        isInline: false,
      },
    ]);
    expect(result.email.attachments[0]).not.toHaveProperty("content");
  });

  it("returns safe validation failures", async () => {
    await expect(parseEml(Buffer.alloc(0), "empty.eml")).resolves.toMatchObject({
      status: "failed",
      error: { code: "EMPTY_FILE" },
    });
    await expect(parseEml(Buffer.from("hello"), "message.txt")).resolves.toMatchObject({
      status: "failed",
      error: { code: "UNSUPPORTED_FILE_TYPE" },
    });
    await expect(
      parseEml(Buffer.from("Subject: Test\n\nbody"), "/private/path/message.eml", {
        maxFileBytes: 4,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "FILE_TOO_LARGE" },
    });
    await expect(parseEml(Buffer.from("not an email"), "broken.eml")).resolves.toMatchObject({
      status: "failed",
      error: { code: "MALFORMED_EMAIL" },
    });
  });
});
