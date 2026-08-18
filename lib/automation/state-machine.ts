import type { AutomationState } from "@/generated/prisma/client";

const transitions: Record<AutomationState, ReadonlySet<AutomationState>> = {
  RECEIVED: new Set(["CLASSIFIED", "FAILED", "CANCELLED"]),
  CLASSIFIED: new Set(["AWAITING_HUMAN", "REPLY_SCHEDULED", "FAILED", "CANCELLED"]),
  AWAITING_HUMAN: new Set(["REPLY_SCHEDULED", "CANCELLED"]),
  REPLY_SCHEDULED: new Set(["SENDING", "CANCELLED"]),
  SENDING: new Set(["REPLY_SCHEDULED", "SENT", "FAILED", "CANCELLED"]),
  SENT: new Set(),
  FAILED: new Set(["REPLY_SCHEDULED", "CANCELLED"]),
  CANCELLED: new Set(),
};

export function canTransitionAutomationState(
  current: AutomationState,
  next: AutomationState,
) {
  return transitions[current].has(next);
}

export function assertAutomationTransition(
  current: AutomationState,
  next: AutomationState,
) {
  if (!canTransitionAutomationState(current, next)) {
    throw new Error(`Invalid automation transition: ${current} -> ${next}`);
  }
}
