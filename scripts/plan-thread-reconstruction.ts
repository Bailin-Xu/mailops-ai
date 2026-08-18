import "dotenv/config";

import { getDb } from "../lib/db";
import { planThreadReconstruction } from "../lib/email/thread-reconstruction";

const db = getDb();

void planThreadReconstruction(db)
  .then((plan) => {
    console.log(JSON.stringify(plan.summary, null, 2));
  })
  .catch(() => {
    console.error("Unable to plan thread reconstruction.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
