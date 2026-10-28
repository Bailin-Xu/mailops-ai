import {
  Prisma,
  type ClassificationCategory,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  classificationCategoryValues,
  classificationResultSchema,
  type AIExecutionMetadata,
  type AIProvider,
} from "@/lib/ai/provider";
import { getDb } from "@/lib/db";
import { inboundContextQuery, isTerminalProcessing, loadClassificationContext, sourceContextHash } from "@/lib/workflow/context";
import { revisionSchema, WorkflowConflictError, workflowTransaction } from "@/lib/workflow/transaction";
import { z } from "zod";

const threadIdSchema = z.string().uuid();
const classificationReviewSchema = z.object({
  classificationId: z.string().uuid(),
  expectedRevision: revisionSchema,
  category: z.enum(classificationCategoryValues),
  note: z.string().trim().max(2000).optional().default(""),
});

export const AUTOMATIC_CLASSIFICATION_CONFIDENCE = 0.7;

export function parseClassificationReview(input: unknown) {
  return classificationReviewSchema.parse(input);
}

export async function runThreadClassification(
  threadIdInput: unknown,
  provider: AIProvider,
  db: PrismaClient = getDb(),
) {
  const threadId = threadIdSchema.parse(threadIdInput);
  const thread = await db.emailThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      subject: true,
      workflowRevision: true,
      mergedIntoThreadId: true,
      messages: inboundContextQuery,
      classifications: { orderBy: [{ threadRevision: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
  });
  if (!thread) throw new Error("The selected thread no longer exists.");
  if (thread.mergedIntoThreadId) throw new WorkflowConflictError();
  const message = thread.messages[0];
  if (!message) throw new Error("Only a thread with an inbound message can be classified.");
  const contextHash = sourceContextHash(thread);
  const previous = thread.classifications[0];
  if (previous && isTerminalProcessing(previous.processingStatus)
    && (!previous.sourceContextHash || previous.sourceContextHash === contextHash)) {
    throw new WorkflowConflictError();
  }

  const cleanBody = message.cleanBody.trim() || message.normalizedBody.trim();
  const metadata: Prisma.InputJsonObject = {
    threadId: thread.id,
    subjectLength: thread.subject.length,
    bodyLength: cleanBody.length,
    sourceContextHash: contextHash,
  };
  const startedAt = performance.now();

  let providerOutput: unknown;
  try {
    providerOutput = await provider.classifyEmail({ subject: thread.subject, cleanBody });
  } catch {
    await recordFailedExecution({
      provider,
      latencyMs: elapsed(startedAt),
      metadata,
      errorMessage: "The classification provider failed.",
      db,
    });
    throw new Error("Classification failed. Retry the request or use the mock provider.");
  }

  const validated = classificationResultSchema.safeParse(providerOutput);
  const executionMetadata = provider.getExecutionMetadata?.(providerOutput);
  if (!validated.success) {
    await recordFailedExecution({
      provider,
      latencyMs: elapsed(startedAt),
      metadata,
      errorMessage: "The provider returned an invalid classification.",
      validationErrors: validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      executionMetadata,
      db,
    });
    throw new Error("Classification output failed validation. The previous result was preserved.");
  }

  const result = validated.data;
  const latencyMs = elapsed(startedAt);
  try {
    return await workflowTransaction(db, async (transaction) => {
      const current = await transaction.emailThread.findUniqueOrThrow({
        where: { id: thread.id },
        include: { messages: inboundContextQuery, classifications: { orderBy: [{ threadRevision: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }], take: 1 } },
      });
      const latest = current.classifications[0];
      if (current.workflowRevision !== thread.workflowRevision
        || sourceContextHash(current) !== contextHash
        || latest?.id !== previous?.id || latest?.revision !== previous?.revision
        || (latest && isTerminalProcessing(latest.processingStatus)
          && (!latest.sourceContextHash || latest.sourceContextHash === contextHash))) {
        throw new WorkflowConflictError();
      }
      await transaction.emailThread.update({
        where: { id: thread.id, workflowRevision: thread.workflowRevision },
        data: { workflowRevision: { increment: 1 } },
      });
      const execution = await transaction.aIExecution.create({
        data: {
          taskType: "CLASSIFICATION",
          provider: provider.id,
          model: provider.model,
          promptVersion: provider.classificationPromptVersion,
          status: "SUCCEEDED",
          latencyMs,
          inputTokens: executionMetadata?.inputTokens,
          outputTokens: executionMetadata?.outputTokens,
          inputMetadata: withProviderResponseMetadata(metadata, executionMetadata),
          output: result,
        },
      });
      const classification = await transaction.classification.create({
        data: {
          threadId: thread.id,
          aiExecutionId: execution.id,
          aiCategory: result.category,
          aiConfidence: result.confidence,
          aiLanguage: result.language,
          threadRevision: thread.workflowRevision + 1,
          sourceContextHash: contextHash,
          requiresHumanReview: requiresClassificationReview(result),
          reviewStatus: requiresClassificationReview(result) ? "PENDING" : "AUTO_ROUTED",
        },
      });
      await transaction.emailThread.update({
        where: { id: thread.id },
        data: {
          status: requiresClassificationReview(result)
            ? "CLASSIFICATION_PENDING_REVIEW"
            : "AUTOMATIC_PROCESSING",
          language: result.language,
        },
      });
      await transaction.draft.updateMany({
        where: { threadId: thread.id, status: "GENERATED" },
        data: { status: "SUPERSEDED" },
      });
      return classification;
    });
  } catch (error) {
    if (error instanceof WorkflowConflictError) {
      await recordFailedExecution({ provider, latencyMs: elapsed(startedAt), metadata,
        errorMessage: "Classification result discarded because its context changed.",
        validationErrors: ["STALE_CONTEXT"], executionMetadata, db });
    }
    throw error;
  }
}

export async function reviewClassification(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const review = parseClassificationReview(input);
  return workflowTransaction(db, async (transaction) => {
    const current = await loadClassificationContext(review.classificationId, transaction);
    if (current.revision !== review.expectedRevision || ["SIMULATED_SENT", "SIMULATED_FORWARDED"].includes(current.processingStatus ?? "")) {
      throw new WorkflowConflictError();
    }
    if (current.reviewStatus === "ACCEPTED" || current.reviewStatus === "CORRECTED") {
      throw new Error("This classification has already been reviewed.");
    }

    const reviewedCategory = review.category as ClassificationCategory;
    const status = reviewedCategory === current.aiCategory ? "ACCEPTED" : "CORRECTED";
    const reviewedAt = new Date();

    const classification = await transaction.classification.update({
      where: { id: current.id, revision: review.expectedRevision },
      data: {
        revision: { increment: 1 },
        reviewedCategory,
        correctionNote: review.note || null,
        reviewStatus: status,
        reviewedAt,
        processingStatus: null,
        route: null,
        knowledgeQuery: null,
        knowledgeMatchCount: 0,
        routingReason: null,
      },
    });
    await transaction.draft.updateMany({
      where: { classificationId: current.id, status: "GENERATED" },
      data: { status: "SUPERSEDED" },
    });
    await transaction.emailThread.update({
      where: { id: current.threadId },
      data: { status: "CLASSIFICATION_REVIEWED", language: current.aiLanguage },
    });
    return classification;
  });
}

export function requiresClassificationReview(result: {
  category: ClassificationCategory;
  confidence: number;
}) {
  return (
    result.confidence < AUTOMATIC_CLASSIFICATION_CONFIDENCE ||
    result.category === "MANUAL_REVIEW"
  );
}

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

async function recordFailedExecution(input: {
  provider: AIProvider;
  latencyMs: number;
  metadata: Prisma.InputJsonObject;
  errorMessage: string;
  validationErrors?: string[];
  executionMetadata?: AIExecutionMetadata;
  db: PrismaClient;
}) {
  await input.db.aIExecution.create({
    data: {
      taskType: "CLASSIFICATION",
      provider: input.provider.id,
      model: input.provider.model,
      promptVersion: input.provider.classificationPromptVersion,
      status: "FAILED",
      latencyMs: input.latencyMs,
      inputTokens: input.executionMetadata?.inputTokens,
      outputTokens: input.executionMetadata?.outputTokens,
      inputMetadata: withProviderResponseMetadata(input.metadata, input.executionMetadata),
      validationErrors: input.validationErrors ?? [],
      errorMessage: input.errorMessage,
    },
  });
}

function withProviderResponseMetadata(
  base: Prisma.InputJsonObject,
  metadata?: AIExecutionMetadata,
): Prisma.InputJsonObject {
  if (!metadata) return base;
  const providerResponse: Prisma.InputJsonObject = {
    ...(metadata.totalTokens !== undefined ? { totalTokens: metadata.totalTokens } : {}),
    ...(metadata.thoughtsTokens !== undefined ? { thoughtsTokens: metadata.thoughtsTokens } : {}),
    ...(metadata.modelVersion ? { modelVersion: metadata.modelVersion } : {}),
    ...(metadata.responseId ? { responseId: metadata.responseId } : {}),
    ...(metadata.finishReason ? { finishReason: metadata.finishReason } : {}),
  };
  return Object.keys(providerResponse).length ? { ...base, providerResponse } : base;
}
