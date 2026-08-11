import { createHash } from "node:crypto";

import type { EmailParticipant } from "@/lib/email/schemas";
import { normalizeSubject } from "@/lib/email/normalize";

type FingerprintInput = {
  subject: string;
  sentAt: Date | null;
  normalizedBody: string;
  participants: EmailParticipant[];
};

export function createEmailFingerprint(input: FingerprintInput): string {
  const senders = input.participants
    .filter((participant) => participant.type === "FROM")
    .map((participant) => participant.normalizedAddress)
    .sort();

  const canonicalValue = JSON.stringify({
    from: senders,
    sentAt: input.sentAt?.toISOString() ?? null,
    subject: normalizeSubject(input.subject),
    body: input.normalizedBody,
  });

  return createHash("sha256").update(canonicalValue, "utf8").digest("hex");
}
