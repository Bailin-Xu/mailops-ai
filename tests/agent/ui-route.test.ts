import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/api/agent/ui/route";
afterEach(() => vi.unstubAllEnvs());
it("hides the UI bridge when disabled and rejects cross-origin commands before execution", async () => {
  vi.stubEnv("AGENT_UI_ENABLED", "false");
  expect((await GET(new Request("http://127.0.0.1:3114/api/agent/ui", {headers:{host:"127.0.0.1:3114"}}))).status).toBe(404);
  vi.stubEnv("AGENT_UI_ENABLED", "true");
  vi.stubEnv("AGENT_RUNTIME_ENABLED", "true");
  vi.stubEnv("AGENT_BRIDGE_TOKEN", "s".repeat(32));
  vi.stubEnv("DATABASE_URL", "postgresql://mailops_test:test@127.0.0.1:5434/mailops_test");
  const cases: Record<string,string>[] = [{host:"127.0.0.1:3114",origin:"https://other.example.test"}, {host:"remote.example.test",origin:"http://remote.example.test"}, {host:"127.0.0.1:3114"}];
  for (const headers of cases) {
    expect((await POST(new Request("http://127.0.0.1:3114/api/agent/ui", {method:"POST",headers,body:"{}"}))).status).toBe(403);
  }
});
