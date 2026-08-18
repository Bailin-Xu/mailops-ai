import { z } from "zod";

export const technicalQueueItemSchema = z.object({
  ticketId: z.string().uuid(),
  summary: z.string().trim().min(5).max(500),
  page: z.string().trim().max(500).nullable(),
  reproductionSteps: z.array(z.string().trim().min(1).max(1000)).max(10),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  artistReference: z.object({
    artistId: z.string().trim().max(200).nullable(),
    wordpressId: z.string().trim().max(200).nullable(),
    email: z.email().nullable(),
  }),
});

export const technicalQueueResultSchema = z.object({
  externalMessageId: z.string().trim().min(1).max(500),
});

export type TechnicalQueueItem = z.infer<typeof technicalQueueItemSchema>;

export interface TechnicalQueueProvider {
  readonly id: string;
  readonly deliveryMode: "SIMULATED" | "EXTERNAL";
  forwardTicket(input: TechnicalQueueItem): Promise<unknown>;
}

export class SimulatedTechnicalQueueProvider implements TechnicalQueueProvider {
  readonly id = "simulated-discord";
  readonly deliveryMode = "SIMULATED" as const;

  async forwardTicket(input: TechnicalQueueItem) {
    const parsed = technicalQueueItemSchema.parse(input);
    return { externalMessageId: `simulated-discord:${parsed.ticketId}` };
  }
}
