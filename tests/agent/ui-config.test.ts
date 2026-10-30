import { expect,it } from "vitest";
import { mockAgentUiEnabled } from "../../lib/agent/ui-config";
const env={NODE_ENV:"test" as const,AGENT_UI_ENABLED:"true",AGENT_RUNTIME_ENABLED:"true",AGENT_BRIDGE_TOKEN:"s".repeat(32),AI_PROVIDER:"mock",SHADOW_MODE:"true",EXTERNAL_DELIVERY_ENABLED:"false",DATABASE_URL:"postgresql://mailops_test:test@127.0.0.1:5434/mailops_test"};
it("enables only the explicitly isolated mock/simulated UI",()=>{
 expect(mockAgentUiEnabled(env)).toBe(true);
 for(const change of [{AGENT_UI_ENABLED:"false"},{AI_PROVIDER:"gemini"},{SHADOW_MODE:"false"},{EXTERNAL_DELIVERY_ENABLED:"true"},{DATABASE_URL:"postgresql://mailops:test@127.0.0.1:5433/mailops"}])expect(mockAgentUiEnabled({...env,...change})).toBe(false);
});
