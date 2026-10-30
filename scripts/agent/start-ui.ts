import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolveTestDatabaseUrl } from "../../tests/support/database-target.mjs";
import { mockAgentUiEnabled } from "../../lib/agent/ui-config";
config({ quiet: true });
try {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: resolveTestDatabaseUrl(process.env),
    AGENT_UI_ENABLED: "true", AGENT_RUNTIME_ENABLED: "true", AGENT_BRIDGE_TOKEN: randomBytes(32).toString("hex"),
    AI_PROVIDER: "mock", SHADOW_MODE: "true", EXTERNAL_DELIVERY_ENABLED: "false", MAILOPS_E2E_FAULTS: "false",
    GEMINI_API_KEY: "", OPENAI_API_KEY: "", LANGSMITH_API_KEY: "", LANGSMITH_TRACING: "false", LANGCHAIN_TRACING_V2: "false" };
  const checkpoint = new URL(env.AGENT_CHECKPOINT_DATABASE_URL ?? "");
  if (!mockAgentUiEnabled(env) || checkpoint.protocol !== "postgresql:" || checkpoint.hostname !== "127.0.0.1"
    || checkpoint.port !== "5436" || checkpoint.pathname !== "/mailops_agent_checkpoint"
    || checkpoint.username !== "mailops_agent_checkpoint" || checkpoint.search || checkpoint.hash) throw new Error();
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3115"], { stdio: "inherit", env });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
  child.on("error", () => { console.error("Unable to start the isolated mock Agent UI."); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} catch {
  console.error("Explicit isolated test and checkpoint databases are required. See docs/agent/a5-mock-review-ui.md.");
  process.exitCode = 1;
}
