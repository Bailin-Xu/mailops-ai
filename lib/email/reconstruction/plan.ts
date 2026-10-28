import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { buildThreadReconstructionPlan } from "../thread-reconstruction";
import { hash, readReconstructionSnapshot } from "./snapshot";

export const PLANNER_VERSION = "rfc-and-preserved-membership-v2";
const uuid = z.string().uuid();
const summarySchema = z.object({ messages: z.number().int().nonnegative(), currentThreads: z.number().int().nonnegative(),
  plannedThreads: z.number().int().nonnegative(), multiMessageThreads: z.number().int().nonnegative(), standaloneThreads: z.number().int().nonnegative(),
  messagesToMove: z.number().int().nonnegative(), threadsToArchive: z.number().int().nonnegative(), incompleteThreads: z.number().int().nonnegative(),
  matchedRelations: z.number().int().nonnegative(), missingReferenceOccurrences: z.number().int().nonnegative(), uniqueMissingReferences: z.number().int().nonnegative(),
  selfReferencesIgnored: z.number().int().nonnegative(), largestThreadSize: z.number().int().nonnegative() });
export const reconstructionPlanSchema = z.object({ schemaVersion: z.literal(1), id: uuid, createdAt: z.string().datetime(),
  plannerVersion: z.literal(PLANNER_VERSION), snapshotHash: z.string().length(64), planHash: z.string().length(64),
  summary: summarySchema,
  threads: z.array(z.object({ retainedThreadId: uuid, retainedMessageId: uuid, messageIds: z.array(uuid).min(1).max(100_000),
    currentThreadIds: z.array(uuid).min(1).max(100_000), isIncomplete: z.boolean(), missingReferenceCount: z.number().int().nonnegative() })).max(100_000),
  threadIdsToArchive: z.array(uuid).max(100_000),
});
export type ReconstructionPlan = z.infer<typeof reconstructionPlanSchema>;
export function planHash(plan: Omit<ReconstructionPlan, "planHash"> | ReconstructionPlan) {
  const { planHash: _hash, ...rest } = plan as ReconstructionPlan;
  void _hash;
  return hash(rest);
}
export async function reconstructionTransaction<T>(db: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  try { return await db.$transaction(operation, { isolationLevel: "Serializable", timeout: 120_000, maxWait: 10_000 }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2025"].includes(error.code)) throw new Error("RECONSTRUCTION_CONCURRENT_CHANGE");
    throw error;
  }
}
export async function prepareThreadReconstruction(db: PrismaClient = getDb()): Promise<ReconstructionPlan> {
  return reconstructionTransaction(db, async (tx) => {
    const snapshot = await readReconstructionSnapshot(tx);
    const plan = { schemaVersion: 1 as const, id: randomUUID(), createdAt: new Date().toISOString(), plannerVersion: PLANNER_VERSION as typeof PLANNER_VERSION,
      snapshotHash: snapshot.signature, ...buildThreadReconstructionPlan(snapshot.messages) };
    return reconstructionPlanSchema.parse({ ...plan, planHash: planHash(plan) });
  });
}
