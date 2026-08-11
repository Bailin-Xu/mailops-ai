import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { parseEml } from "../lib/email/parser";

async function main() {
  const directory = resolve(process.argv[2] ?? "data/raw/all-eml");
  const entries = await readdir(directory, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".eml"))
    .map((entry) => entry.name)
    .sort();

  const summary = {
    totalFiles: fileNames.length,
    parsed: 0,
    parsedWithWarnings: 0,
    failed: 0,
    attachmentMetadataRecords: 0,
    warningCounts: {} as Record<string, number>,
    failureCounts: {} as Record<string, number>,
  };

  for (const fileName of fileNames) {
    try {
      const input = await readFile(resolve(directory, fileName));
      const result = await parseEml(input, fileName);

      if (result.status === "failed") {
        summary.failed += 1;
        increment(summary.failureCounts, result.error.code);
        continue;
      }

      summary.parsed += 1;
      summary.attachmentMetadataRecords += result.email.attachments.length;

      if (result.email.parseStatus === "PARSED_WITH_WARNINGS") {
        summary.parsedWithWarnings += 1;
        result.email.parseWarnings.forEach((warning) => increment(summary.warningCounts, warning));
      }
    } catch {
      summary.failed += 1;
      increment(summary.failureCounts, "READ_FAILED");
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

void main().catch(() => {
  console.error("Unable to scan the local EML directory.");
  process.exitCode = 1;
});

function increment(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}
