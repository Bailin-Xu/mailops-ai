export function agentTarget(raw: string | undefined) {
  if (!raw) throw new Error("AGENT_FIXTURE_DATABASE_URL is required; no fallback");
  const u = new URL(raw);
  if (u.protocol !== "postgresql:" || u.hostname !== "127.0.0.1" || u.port !== "5435"
    || u.pathname !== "/mailops_agent_a0" || u.username !== "mailops_agent_a0" || u.search || u.hash)
    throw new Error("Only the dedicated A0 fixture database is allowed");
  return raw;
}
