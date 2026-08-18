import "dotenv/config";

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { getDb } from "../lib/db";
import { MockAIProvider } from "../lib/ai/mock-provider";
import { ingestAndProcessEml } from "../lib/processing/ingestion";

const db = getDb();
const provider = new MockAIProvider();

async function main() {
  const directory = resolve(process.argv[2] ?? "data/raw/all-eml");
  const entries = await readdir(directory, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".eml"))
    .map((entry) => entry.name)
    .sort();

  const summary = {
    totalFiles: fileNames.length,
    imported: 0,
    duplicates: 0,
    failed: 0,
    automaticallyProcessed: 0,
    automaticProcessingFailed: 0,
    automaticProcessingSkipped: 0,
    duplicateMatches: {
      MESSAGE_ID: 0,
      FINGERPRINT: 0,
    },
    failureCounts: {} as Record<string, number>,
    databaseBefore: await getDatabaseCounts(),
    databaseAfter: emptyDatabaseCounts(),
  };

  for (const fileName of fileNames) {
    try {
      const input = await readFile(resolve(directory, fileName));
      const automatic = await ingestAndProcessEml(input, fileName, { db, provider });
      const result = automatic.ingestion;

      if (result.status === "imported") {
        summary.imported += 1;
        if (automatic.processing === "COMPLETED") summary.automaticallyProcessed += 1;
        if (automatic.processing === "FAILED") summary.automaticProcessingFailed += 1;
        if (automatic.processing === "SKIPPED_NON_INBOUND") summary.automaticProcessingSkipped += 1;
      } else if (result.status === "duplicate") {
        summary.duplicates += 1;
        summary.duplicateMatches[result.matchedBy] += 1;
      } else {
        summary.failed += 1;
        increment(summary.failureCounts, result.error.code);
      }
    } catch {
      summary.failed += 1;
      increment(summary.failureCounts, "READ_FAILED");
    }
  }

  summary.databaseAfter = await getDatabaseCounts();
  console.log(JSON.stringify(summary, null, 2));
}

async function getDatabaseCounts() {
  const [threads, messages, participants, attachmentMetadata] = await Promise.all([
    db.emailThread.count(),
    db.emailMessage.count(),
    db.emailParticipant.count(),
    db.attachmentMetadata.count(),
  ]);

  return { threads, messages, participants, attachmentMetadata };
}

function emptyDatabaseCounts() {
  return { threads: 0, messages: 0, participants: 0, attachmentMetadata: 0 };
}

function increment(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

void main()
  .catch(() => {
    console.error("Unable to import the local EML directory.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
