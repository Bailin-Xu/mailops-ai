import { z } from "zod";

const providerParticipantSchema = z.object({
  type: z.enum(["FROM", "TO", "CC", "BCC", "REPLY_TO"]),
  displayName: z.string().trim().max(500).nullable(),
  emailAddress: z.email(),
}).strict();

export const inboundProviderMessageSchema = z.object({
  sourceProvider: z.literal("GMAIL"),
  externalMessageId: z.string().trim().min(1).max(500),
  externalThreadId: z.string().trim().min(1).max(500),
  providerHistoryId: z.string().trim().min(1).max(500).nullable(),
  messageId: z.string().trim().min(1).max(1000).nullable(),
  inReplyTo: z.string().trim().min(1).max(1000).nullable(),
  references: z.array(z.string().trim().min(1).max(1000)).max(100),
  subject: z.string().max(500),
  sentAt: z.iso.datetime().nullable(),
  textBody: z.string().max(1_000_000).nullable(),
  htmlBody: z.string().max(2_000_000).nullable(),
  participants: z.array(providerParticipantSchema).min(1).max(200),
  attachments: z.array(z.object({
    fileName: z.string().max(1000).nullable(),
    mimeType: z.string().trim().min(1).max(500),
    sizeBytes: z.number().int().nonnegative(),
    contentId: z.string().max(1000).nullable(),
    isInline: z.boolean(),
  }).strict()).max(200),
}).strict();

export interface EmailIngestionProvider {
  readonly id: string;
  getMessage(externalMessageId: string): Promise<unknown>;
}

export const outboundReplySchema = z.object({
  dispatchId: z.string().uuid(),
  externalThreadId: z.string().trim().min(1).max(500),
  inReplyTo: z.string().trim().min(1).max(1000),
  references: z.array(z.string().trim().min(1).max(1000)).max(100),
  to: z.email(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000),
});

export const outboundReplyResultSchema = z.object({
  externalMessageId: z.string().trim().min(1).max(500),
  externalThreadId: z.string().trim().min(1).max(500),
});

export type OutboundReply = z.infer<typeof outboundReplySchema>;
export type OutboundReplyResult = z.infer<typeof outboundReplyResultSchema>;

export interface EmailDeliveryProvider {
  readonly id: string;
  readonly deliveryMode: "SIMULATED" | "EXTERNAL";
  sendReply(input: OutboundReply): Promise<unknown>;
}

export class SimulatedEmailDeliveryProvider implements EmailDeliveryProvider {
  readonly id = "simulated-email";
  readonly deliveryMode = "SIMULATED" as const;

  async sendReply(input: OutboundReply): Promise<OutboundReplyResult> {
    const parsed = outboundReplySchema.parse(input);
    return {
      externalMessageId: `simulated:${parsed.dispatchId}`,
      externalThreadId: parsed.externalThreadId,
    };
  }
}
