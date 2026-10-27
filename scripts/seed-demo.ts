import "dotenv/config";

import { getDb } from "../lib/db";
import { seedNeutralDemo } from "./demo/seed";

const db = getDb();
void seedNeutralDemo(db)
  .then((counts) => console.log(JSON.stringify({ ...counts, aiCalls: 0 })))
  .catch(() => {
    console.error("Unable to seed the synthetic demo. Verify the database and migrations.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
