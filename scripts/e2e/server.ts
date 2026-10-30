import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { spawn } from "node:child_process";
import { resolveTestDatabaseUrl } from "../../tests/support/database-target.mjs";
config({ quiet: true });
const url = resolveTestDatabaseUrl(process.env);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3114"], {
  stdio: "inherit", env: { ...process.env, DATABASE_URL: url, AI_PROVIDER: "mock", GEMINI_API_KEY: "", GEMINI_MODEL: "",
    MAILOPS_E2E_FAULTS: "true", AGENT_UI_ENABLED:process.env.MAILOPS_E2E_AGENT==="true"?"true":"false",AGENT_RUNTIME_ENABLED:process.env.MAILOPS_E2E_AGENT==="true"?"true":"false",AGENT_BRIDGE_TOKEN:randomBytes(32).toString("hex"), SHADOW_MODE: "true", EXTERNAL_DELIVERY_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" },
});
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
