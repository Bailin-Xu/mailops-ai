import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  technicalQueueResultSchema,
  type TechnicalQueueProvider,
} from "@/lib/integrations/technical-queue-provider";
import { z } from "zod";

export const bugReportSchema = z.object({
  summary: z.string().trim().min(5).max(500),
  page: z.string().trim().max(500).nullable().default(null),
  reproductionSteps: z.array(z.string().trim().min(1).max(1000)).max(10).default([]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  artistId: z.string().trim().max(200).nullable().default(null),
  wordpressId: z.string().trim().max(200).nullable().default(null),
  artistEmail: z.email().nullable().default(null),
});

const createSchema = z.object({
  classificationId: z.string().uuid(),
  report: bugReportSchema,
});

const claimSchema = z.object({
  ticketId: z.string().uuid(),
  developerExternalId: z.string().trim().min(1).max(200),
});

const resolutionSchema = claimSchema.extend({
  reply: z.string().trim().min(1).max(20_000),
});

export async function createBugTicket(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const request = createSchema.parse(input);
  const classification = await db.classification.findUnique({
    where: { id: request.classificationId },
    include: { thread: true },
  });
  if (!classification) throw new Error("The selected classification no longer exists.");
  const category = classification.reviewedCategory ?? classification.aiCategory;
  if (category !== "TECHNICAL_ISSUE") {
    throw new Error("Bug tickets require a technical-issue classification.");
  }

  try {
    return await db.$transaction(async (transaction) => {
      const existing = await transaction.bugTicket.findUnique({
        where: { classificationId: classification.id },
      });
      if (existing) return existing;

      const ticket = await transaction.bugTicket.create({
        data: {
          threadId: classification.threadId,
          classificationId: classification.id,
          ...request.report,
        },
      });
      await transaction.emailThread.update({
        where: { id: classification.threadId },
        data: {
          automationState: "AWAITING_HUMAN",
          artistId: request.report.artistId ?? classification.thread.artistId,
          wordpressId: request.report.wordpressId ?? classification.thread.wordpressId,
          artistEmail: request.report.artistEmail ?? classification.thread.artistEmail,
        },
      });
      await transaction.auditEvent.create({
        data: {
          eventType: "BUG_TICKET_CREATED",
          entityType: "BugTicket",
          entityId: ticket.id,
          metadata: {
            threadId: ticket.threadId,
            classificationId: ticket.classificationId,
            severity: ticket.severity,
          },
        },
      });
      return ticket;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return db.bugTicket.findUniqueOrThrow({
        where: { classificationId: classification.id },
      });
    }
    throw error;
  }
}

export async function forwardBugTicket(
  ticketIdInput: unknown,
  provider: TechnicalQueueProvider,
  db: PrismaClient = getDb(),
) {
  const ticketId = z.string().uuid().parse(ticketIdInput);
  if (provider.deliveryMode !== "SIMULATED") {
    throw new Error("External technical-queue delivery is disabled in Phase 1.");
  }
  const ticket = await db.bugTicket.findUnique({ where: { id: ticketId } });
  if (!ticket || (ticket.status !== "RECEIVED" && ticket.status !== "FAILED")) {
    throw new Error("This bug ticket is not ready for queue forwarding.");
  }

  const output = technicalQueueResultSchema.parse(await provider.forwardTicket({
    ticketId: ticket.id,
    summary: ticket.summary,
    page: ticket.page,
    reproductionSteps: ticket.reproductionSteps,
    severity: ticket.severity,
    artistReference: {
      artistId: ticket.artistId,
      wordpressId: ticket.wordpressId,
      email: ticket.artistEmail,
    },
  }));

  return db.$transaction(async (transaction) => {
    const updated = await transaction.bugTicket.update({
      where: { id: ticket.id },
      data: { status: "QUEUED", discordMessageId: output.externalMessageId },
    });
    await transaction.auditEvent.create({
      data: {
        eventType: "BUG_TICKET_SIMULATED_FORWARD",
        entityType: "BugTicket",
        entityId: ticket.id,
        metadata: { provider: provider.id, externalMessageId: output.externalMessageId },
      },
    });
    return updated;
  });
}

export async function claimBugTicket(
  input: unknown,
  options: { db?: PrismaClient; now?: Date } = {},
) {
  const request = claimSchema.parse(input);
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  return db.$transaction(async (transaction) => {
    const updated = await transaction.bugTicket.updateMany({
      where: {
        id: request.ticketId,
        status: "QUEUED",
        assignedDeveloperExternalId: null,
      },
      data: {
        status: "CLAIMED",
        assignedDeveloperExternalId: request.developerExternalId,
        claimedAt: now,
      },
    });
    if (updated.count !== 1) return null;

    const ticket = await transaction.bugTicket.findUniqueOrThrow({ where: { id: request.ticketId } });
    await transaction.auditEvent.create({
      data: {
        eventType: "BUG_TICKET_CLAIMED",
        entityType: "BugTicket",
        entityId: ticket.id,
        metadata: { developerExternalId: request.developerExternalId },
      },
    });
    return ticket;
  });
}

export async function submitBugResolution(
  input: unknown,
  options: { db?: PrismaClient; now?: Date } = {},
) {
  const request = resolutionSchema.parse(input);
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const current = await db.bugTicket.findUnique({ where: { id: request.ticketId } });
  if (
    !current
    || current.status !== "CLAIMED"
    || current.assignedDeveloperExternalId !== request.developerExternalId
  ) {
    throw new Error("Only the assigned developer can resolve this bug ticket.");
  }

  return db.$transaction(async (transaction) => {
    const ticket = await transaction.bugTicket.update({
      where: { id: current.id },
      data: {
        status: "RESOLVED",
        developerReply: request.reply,
        replySubmittedAt: now,
        resolvedAt: now,
      },
    });
    await transaction.auditEvent.create({
      data: {
        eventType: "BUG_TICKET_RESOLVED",
        entityType: "BugTicket",
        entityId: current.id,
        metadata: { developerExternalId: request.developerExternalId },
      },
    });
    return ticket;
  });
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
