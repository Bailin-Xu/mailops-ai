import { describe, it, expect } from "vitest";
import fixtures from "../../contracts/agent/fixtures.json";
import { schemas, validateContract } from "../../contracts/agent/schema";
describe("agent-v1 shared boundary fixtures", () => {
  for (const fixture of fixtures) it(fixture.name, () => {
    const check = () => validateContract(fixture.kind as keyof typeof schemas, fixture.value);
    if (fixture.valid) expect(check).not.toThrow(); else expect(check).toThrow();
  });
});
