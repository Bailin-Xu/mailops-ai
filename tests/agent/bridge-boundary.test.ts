import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/agent/commands/route";
vi.mock("../../lib/db",()=>({getDb:()=>{throw new Error("Business database must not be touched before authorization");}}));
afterEach(()=>vi.unstubAllEnvs());
it("Agent bridge is disabled by default",async()=>{
 vi.stubEnv("AGENT_RUNTIME_ENABLED","false");
 expect((await POST(new Request("http://127.0.0.1/api/agent/commands",{method:"POST",body:"{}"}))).status).toBe(404);
});
it("Agent bridge rejects missing credentials and browser origins",async()=>{
 vi.stubEnv("AGENT_RUNTIME_ENABLED","true");vi.stubEnv("AGENT_BRIDGE_TOKEN","s".repeat(32));
 for(const headers of [new Headers(),new Headers({Authorization:"Bearer "+"s".repeat(32),Origin:"https://example.invalid"})]){
  const response=await POST(new Request("http://127.0.0.1/api/agent/commands",{method:"POST",headers,body:"{}"}));expect(response.status).toBe(403);
 }
});
