import { fork } from "node:child_process";
import { resolve } from "node:path";

type Fixture = ReturnType<typeof import("../support/review-fixtures").syntheticFixtures>;
/** Keep Prisma's TypeScript loader in a separate Node process, outside Playwright transforms. */
export function browserFixtures() {
  const child = fork(resolve("scripts/e2e/fixtures.ts"), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"] });
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  child.on("message", (message: { id: number; result?: unknown; error?: string }) => {
    const operation = pending.get(message.id); if (!operation) return;
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error)); else operation.resolve(message.result);
  });
  const fail = () => { for (const operation of pending.values()) operation.reject(new Error("Synthetic fixture process stopped.")); pending.clear(); };
  child.on("error", fail); child.on("exit", fail);
  const call = (method: string, input?: unknown) => new Promise<unknown>((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); child.send({ id, method, input });
  });
  return {
    create: (input?: Parameters<Fixture["create"]>[0]) => call("create", input) as ReturnType<Fixture["create"]>,
    reconstruct: (input: Parameters<Fixture["reconstruct"]>[0]) => call("reconstruct", input),
    clearPreview: (input: Parameters<Fixture["clearPreview"]>[0]) => call("clearPreview", input),
    executionCount: () => call("count") as Promise<number>,
    cleanup: async () => { try { await call("cleanup"); } finally { child.kill(); } },
  };
}
