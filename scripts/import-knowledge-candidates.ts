import "dotenv/config";

import { getDb } from "../lib/db";
import { importKnowledgeCandidates } from "../lib/knowledge/candidate-import";

async function main() {
  console.log(JSON.stringify(await importKnowledgeCandidates(), null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Knowledge candidate import failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
