import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import data from "../../contracts/agent/dataset.json";
import { agentTarget } from "../../scripts/agent/target";
it("freezes bilingual, family-disjoint datasets with valid source annotations", () => {
  const raw = readFileSync("contracts/agent/dataset.json");
  expect(createHash("sha256").update(raw).digest("hex")).toBe(readFileSync("contracts/agent/dataset.sha256", "utf8").trim());
  expect(new Set(data.cases.map(c => c.id)).size).toBe(100);
  for (const [split, count] of [["tuning",60],["holdout",40]] as const) {
    const cases = data.cases.filter(c => c.split === split);
    expect(cases).toHaveLength(count);
    expect(cases.filter(c => c.language === "fr")).toHaveLength(count/2);
  }
  const tuning = new Set(data.cases.filter(c => c.split === "tuning").map(c => c.family));
  expect(data.cases.filter(c => c.split === "holdout").every(c => !tuning.has(c.family))).toBe(true);
  for (const c of data.cases) {
    for (const id of c.relevantSourceIds) expect(data.knowledge.some(k => k.id === id && k.status === "ACTIVE")).toBe(true);
    if (c.expectedRoute === "KNOWN_KNOWLEDGE") expect(c.supportedClaims.length).toBeGreaterThan(0);
  }
});
it("rejects missing, development, test and remote database targets before connection", () => {
  for (const raw of [undefined,"postgresql://mailops@127.0.0.1:5433/mailops", "postgresql://mailops_test@127.0.0.1:5434/mailops_test", "postgresql://mailops_agent_a0@remote:5435/mailops_agent_a0", "postgresql://mailops_agent_a0@127.0.0.1:5435/mailops_agent_a0?options=bad"]) expect(() => agentTarget(raw)).toThrow();
  expect(agentTarget("postgresql://mailops_agent_a0@127.0.0.1:5435/mailops_agent_a0")).toContain("5435");
});
