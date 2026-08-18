import type { Address, Mailbox } from "postal-mime";

import type {
  EmailParticipant,
  EmailParticipantType,
} from "@/lib/email/schemas";

const WINDOWS_1252_C1_REPLACEMENTS: Readonly<Record<string, string>> = {
  "\u0080": "€",
  "\u0082": "‚",
  "\u0083": "ƒ",
  "\u0084": "„",
  "\u0085": "…",
  "\u0086": "†",
  "\u0087": "‡",
  "\u0088": "ˆ",
  "\u0089": "‰",
  "\u008a": "Š",
  "\u008b": "‹",
  "\u008c": "Œ",
  "\u008e": "Ž",
  "\u0091": "‘",
  "\u0092": "’",
  "\u0093": "“",
  "\u0094": "”",
  "\u0095": "•",
  "\u0096": "–",
  "\u0097": "—",
  "\u0098": "˜",
  "\u0099": "™",
  "\u009a": "š",
  "\u009b": "›",
  "\u009c": "œ",
  "\u009e": "ž",
  "\u009f": "Ÿ",
};

export function repairWindows1252Controls(value: string): string {
  return value.replace(/[\u0080-\u009f]/g, (character) => {
    return WINDOWS_1252_C1_REPLACEMENTS[character] ?? character;
  });
}

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
  return repairWindows1252Controls(value)
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeSubject(value: string): string {
  return repairWindows1252Controls(value)
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
          displayName: repairWindows1252Controls(mailbox.name).normalize("NFC").trim() || null,
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
