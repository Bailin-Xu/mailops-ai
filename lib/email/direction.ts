import type {
  EmailDirection,
  EmailParticipant,
} from "@/lib/email/schemas";

const RECIPIENT_TYPES = new Set(["TO", "CC", "BCC"]);

export function classifyEmailDirection(
  participants: readonly EmailParticipant[],
  ownedAddresses: readonly string[],
): EmailDirection {
  const owned = new Set(
    ownedAddresses.map((address) => address.trim().toLowerCase()).filter(Boolean),
  );

  if (owned.size === 0) return "UNKNOWN";

  const sentByOwnedAddress = participants.some(
    (participant) =>
      participant.type === "FROM" && owned.has(participant.normalizedAddress),
  );
  const sentToOwnedAddress = participants.some(
    (participant) =>
      RECIPIENT_TYPES.has(participant.type) &&
      owned.has(participant.normalizedAddress),
  );

  if (sentByOwnedAddress && sentToOwnedAddress) return "SELF";
  if (sentByOwnedAddress) return "OUTBOUND";
  if (sentToOwnedAddress) return "INBOUND";
  return "UNKNOWN";
}
