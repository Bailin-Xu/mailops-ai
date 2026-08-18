import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  inboundProviderMessageSchema,
  SimulatedEmailDeliveryProvider,
} from "@/lib/integrations/email-provider";
import { SimulatedTechnicalQueueProvider } from "@/lib/integrations/technical-queue-provider";

describe("simulated integration providers", () => {
  it("returns deterministic email identifiers without contacting a mailbox", async () => {
    const dispatchId = randomUUID();
    await expect(new SimulatedEmailDeliveryProvider().sendReply({
      dispatchId,
      externalThreadId: "gmail-thread-synthetic",
      inReplyTo: "<synthetic@example.test>",
      references: ["<synthetic@example.test>"],
      to: "artist@example.test",
      subject: "Re: Synthetic question",
      body: "Synthetic verified reply.",
    })).resolves.toEqual({
      externalMessageId: `simulated:${dispatchId}`,
      externalThreadId: "gmail-thread-synthetic",
    });
  });

  it("accepts provider metadata but rejects attachment content at the boundary", () => {
    const message = {
      sourceProvider: "GMAIL",
      externalMessageId: "gmail-message-synthetic",
      externalThreadId: "gmail-thread-synthetic",
      providerHistoryId: "123",
      messageId: "<synthetic@example.test>",
      inReplyTo: null,
      references: [],
      subject: "Synthetic",
      sentAt: "2026-08-18T12:00:00.000Z",
      textBody: "Synthetic body",
      htmlBody: null,
      participants: [{ type: "FROM", displayName: null, emailAddress: "artist@example.test" }],
      attachments: [{
        fileName: "safe.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        contentId: null,
        isInline: false,
      }],
    };
    expect(inboundProviderMessageSchema.safeParse(message).success).toBe(true);
    expect(inboundProviderMessageSchema.safeParse({
      ...message,
      attachments: [{ ...message.attachments[0], content: "must-not-enter-core" }],
    }).success).toBe(false);
  });

  it("returns a deterministic technical-queue identifier", async () => {
    const ticketId = randomUUID();
    await expect(new SimulatedTechnicalQueueProvider().forwardTicket({
      ticketId,
      summary: "Synthetic upload failure",
      page: "/artist/media",
      reproductionSteps: ["Open the synthetic form", "Submit a safe fixture"],
      severity: "MEDIUM",
      artistReference: { artistId: null, wordpressId: null, email: "artist@example.test" },
    })).resolves.toEqual({ externalMessageId: `simulated-discord:${ticketId}` });
  });
});
