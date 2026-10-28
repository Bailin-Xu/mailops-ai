import { syntheticFixtures } from "../../tests/support/review-fixtures";
const fixtures = syntheticFixtures();
process.on("message", async (message: { id: number; method: "create" | "count" | "cleanup"; input?: Parameters<typeof fixtures.create>[0] }) => {
  try {
    const result = message.method === "create" ? await fixtures.create(message.input)
      : message.method === "count" ? await fixtures.db.aIExecution.count() : await fixtures.cleanup();
    process.send?.({ id: message.id, result }, () => { if (message.method === "cleanup") process.disconnect(); });
  } catch {
    process.send?.({ id: message.id, error: "Synthetic test fixture operation failed." });
  }
});
