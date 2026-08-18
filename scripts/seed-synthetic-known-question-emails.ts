import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getDb } from "../lib/db";
import { ingestEml } from "../lib/email/ingestion";

const fixtureDirectory = resolve("tests/fixtures/eml");
const fixtureNames = [
  "demo-known-gallery-appointment.eml",
  "demo-known-gallery-admission.eml",
  "demo-known-minimum-artwork-price.eml",
] as const;
const db = getDb();

async function main() {
  const results = [];

  for (const fixtureName of fixtureNames) {
    const input = await readFile(resolve(fixtureDirectory, fixtureName));
    const result = await ingestEml(input, fixtureName, {
      db,
      ownedAddresses: ["support@example.test"],
    });
    results.push({ fixtureName, ...result });
  }

  console.log(JSON.stringify(results, null, 2));
}

void main()
  .catch(() => {
    console.error("Unable to seed synthetic known-question emails.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
