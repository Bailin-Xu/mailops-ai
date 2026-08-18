import { describe, expect, it } from "vitest";

import { classifyEmailDirection } from "@/lib/email/direction";
import type { EmailParticipant } from "@/lib/email/schemas";

const ownedAddress = "support@example.test";

describe("classifyEmailDirection", () => {
  it("marks mail received by an owned address as inbound", () => {
    expect(
      classifyEmailDirection(
        [participant("FROM", "customer@example.test"), participant("TO", ownedAddress)],
        [ownedAddress],
      ),
    ).toBe("INBOUND");
  });

  it("marks mail sent by an owned address as outbound", () => {
    expect(
      classifyEmailDirection(
        [participant("FROM", ownedAddress), participant("TO", "customer@example.test")],
        [ownedAddress.toUpperCase()],
      ),
    ).toBe("OUTBOUND");
  });

  it("marks mail sent from and to owned addresses as self", () => {
    expect(
      classifyEmailDirection(
        [participant("FROM", ownedAddress), participant("CC", ownedAddress)],
        [ownedAddress],
      ),
    ).toBe("SELF");
  });

  it("marks mail without an owned participant as unknown", () => {
    expect(
      classifyEmailDirection(
        [
          participant("FROM", "first@example.test"),
          participant("TO", "second@example.test"),
        ],
        [ownedAddress],
      ),
    ).toBe("UNKNOWN");
    expect(classifyEmailDirection([], [])).toBe("UNKNOWN");
  });
});

function participant(
  type: EmailParticipant["type"],
  emailAddress: string,
): EmailParticipant {
  return {
    type,
    displayName: null,
    emailAddress,
    normalizedAddress: emailAddress.toLowerCase(),
  };
}
