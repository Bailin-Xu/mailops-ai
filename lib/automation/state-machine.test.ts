import { describe, expect, it } from "vitest";

import {
  assertAutomationTransition,
  canTransitionAutomationState,
} from "@/lib/automation/state-machine";

describe("automation state machine", () => {
  it("allows the durable reply lifecycle and retry transition", () => {
    expect(canTransitionAutomationState("RECEIVED", "CLASSIFIED")).toBe(true);
    expect(canTransitionAutomationState("CLASSIFIED", "REPLY_SCHEDULED")).toBe(true);
    expect(canTransitionAutomationState("REPLY_SCHEDULED", "SENDING")).toBe(true);
    expect(canTransitionAutomationState("SENDING", "REPLY_SCHEDULED")).toBe(true);
    expect(canTransitionAutomationState("SENDING", "SENT")).toBe(true);
  });

  it("keeps sent and cancelled states terminal", () => {
    expect(canTransitionAutomationState("SENT", "SENDING")).toBe(false);
    expect(() => assertAutomationTransition("CANCELLED", "REPLY_SCHEDULED"))
      .toThrow("Invalid automation transition");
  });
});
