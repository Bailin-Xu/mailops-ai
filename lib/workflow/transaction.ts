import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";

export class WorkflowConflictError extends Error {
  constructor() {
    super("This result is stale or has already changed. Refresh the page and review the latest version before retrying.");
  }
}

// Reject null/empty hidden fields instead of coercing a missing token to zero.
export const revisionSchema = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^\d+$/u).transform(Number),
]).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));

export async function workflowTransaction<T>(
  db: PrismaClient,
  action: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await db.$transaction(action, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2025"].includes(error.code)) {
      throw new WorkflowConflictError();
    }
    throw error;
  }
}
