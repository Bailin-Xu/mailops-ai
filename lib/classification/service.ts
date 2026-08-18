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
import { z } from "zod";

const threadIdSchema = z.string().uuid();
const classificationReviewSchema = z.object({
  classificationId: z.string().uuid(),
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
      messages: {
        where: { direction: "INBOUND" },
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { cleanBody: true, normalizedBody: true },
      },
    },
  });
  if (!thread) throw new Error("The selected thread no longer exists.");
  const message = thread.messages[0];
  if (!message) throw new Error("Only a thread with an inbound message can be classified.");

  const cleanBody = message.cleanBody.trim() || message.normalizedBody.trim();
  const metadata: Prisma.InputJsonObject = {
    threadId: thread.id,
    subjectLength: thread.subject.length,
    bodyLength: cleanBody.length,
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
  return db.$transaction(async (transaction) => {
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
    return classification;
  });
}

export async function reviewClassification(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const review = parseClassificationReview(input);
  const current = await db.classification.findUnique({
    where: { id: review.classificationId },
  });
  if (!current) throw new Error("The selected classification no longer exists.");
  if (current.reviewStatus === "ACCEPTED" || current.reviewStatus === "CORRECTED") {
    throw new Error("This classification has already been reviewed.");
  }

  const reviewedCategory = review.category as ClassificationCategory;
  const status = reviewedCategory === current.aiCategory ? "ACCEPTED" : "CORRECTED";
  const reviewedAt = new Date();

  return db.$transaction(async (transaction) => {
    const classification = await transaction.classification.update({
      where: { id: current.id },
      data: {
        reviewedCategory,
        correctionNote: review.note || null,
        reviewStatus: status,
        reviewedAt,
      },
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
