import { syntheticFixtures } from "../../tests/support/review-fixtures";
const fixtures = syntheticFixtures();
process.on("message", async (message: { id: number; method: "create" | "count" | "cleanup" | "reconstruct" | "clearPreview"; input?: Parameters<typeof fixtures.create>[0] | Parameters<typeof fixtures.reconstruct>[0] | Parameters<typeof fixtures.clearPreview>[0] }) => {
  try {
    const result = message.method === "create" ? await fixtures.create(message.input as Parameters<typeof fixtures.create>[0])
      : message.method === "clearPreview" ? await fixtures.clearPreview(message.input as Parameters<typeof fixtures.clearPreview>[0]) : message.method === "count" ? await fixtures.db.aIExecution.count() : message.method === "reconstruct" ? await fixtures.reconstruct(message.input as Parameters<typeof fixtures.reconstruct>[0]) : await fixtures.cleanup();
    process.send?.({ id: message.id, result }, () => { if (message.method === "cleanup") process.disconnect(); });
  } catch {
    process.send?.({ id: message.id, error: "Synthetic test fixture operation failed." });
  }
});
