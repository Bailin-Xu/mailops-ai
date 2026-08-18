import type { EmailDirection } from "@/lib/email/schemas";
import type { KnowledgeSourceStatus } from "@/lib/knowledge/historical-source-assessment";

export function isEligibleHistoricalKnowledgeSource(
  direction: EmailDirection,
  status: KnowledgeSourceStatus,
): boolean {
  return direction === "OUTBOUND" && status === "READY_FOR_REVIEW";
}

export function assertEligibleHistoricalKnowledgeSource(
  direction: EmailDirection,
  status: KnowledgeSourceStatus,
): void {
  if (!isEligibleHistoricalKnowledgeSource(direction, status)) {
    throw new Error(
      "Only outbound email that passed prescreening may be used as a historical knowledge source.",
    );
  }
}
