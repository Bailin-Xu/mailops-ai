import type { Address, Mailbox } from "postal-mime";

import type {
  EmailParticipant,
  EmailParticipantType,
} from "@/lib/email/schemas";

export function normalizeMessageId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/^<|>$/g, "").trim().toLowerCase() || null;
}

export function parseReferences(value: string | null | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  const bracketedIds = value.match(/<[^>]+>/g);
  const candidates = bracketedIds ?? value.split(/\s+/);

  return [
    ...new Set(
      candidates
        .map((candidate) => normalizeMessageId(candidate))
        .filter((candidate): candidate is string => candidate !== null),
    ),
  ];
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeSubject(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function toParticipants(
  type: EmailParticipantType,
  addresses: Address | Address[] | undefined,
): EmailParticipant[] {
  const addressList = addresses ? (Array.isArray(addresses) ? addresses : [addresses]) : [];

  return addressList.flatMap((address) =>
    flattenAddress(address).flatMap((mailbox) => {
      const emailAddress = mailbox.address.trim();
      if (!emailAddress) {
        return [];
      }

      return [
        {
          type,
          displayName: mailbox.name.trim() || null,
          emailAddress,
          normalizedAddress: emailAddress.toLowerCase(),
        },
      ];
    }),
  );
}

function flattenAddress(address: Address): Mailbox[] {
  return "group" in address && address.group ? address.group : [address];
}
