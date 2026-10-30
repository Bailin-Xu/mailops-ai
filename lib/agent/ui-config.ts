export function mockAgentUiEnabled(env: NodeJS.ProcessEnv = process.env) {
  if(env.AGENT_UI_ENABLED!=="true"||env.AGENT_RUNTIME_ENABLED!=="true"||env.AI_PROVIDER!=="mock"||env.SHADOW_MODE!=="true"||env.EXTERNAL_DELIVERY_ENABLED!=="false"||!env.AGENT_BRIDGE_TOKEN||env.AGENT_BRIDGE_TOKEN.length<32)return false;
  try{const u=new URL(env.DATABASE_URL??"");return u.protocol==="postgresql:"&&u.hostname==="127.0.0.1"&&u.port==="5434"&&u.pathname==="/mailops_test"&&u.username==="mailops_test"&&!u.search&&!u.hash;}catch{return false;}
}
