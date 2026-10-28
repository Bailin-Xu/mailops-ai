import type { ClassificationCategory, PrismaClient } from "@/generated/prisma/client";
import { draftResultSchema, type AIExecutionMetadata, type AIProvider } from "@/lib/ai/provider";
import { reviewClassification } from "@/lib/classification/service";
import { getDb } from "@/lib/db";
import { searchActiveKnowledge } from "@/lib/knowledge/search";
import { captureApprovedKnowledge, sameKnowledgeFacts, type VersionedGrounding } from "@/lib/knowledge/revisions";
import { captureDraftInput, draftInputSnapshotSchema } from "./evidence";
import { assertCurrentContext, isTerminalProcessing, knowledgeFingerprint, loadClassificationContext, type ClassificationContext } from "@/lib/workflow/context";
import { revisionSchema, WorkflowConflictError, workflowTransaction } from "@/lib/workflow/transaction";
import { z } from "zod";

const idSchema = z.string().uuid();
const manualAnswerSchema = z.object({
  classificationId: z.string().uuid(),
  expectedRevision: revisionSchema,
  body: z.string().trim().min(1).max(20_000),
  createCandidate: z.boolean().default(false),
});
const confirmedDraftSchema = z.object({
  draftId: z.string().uuid(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000),
  language: z.enum(["en", "fr", "mixed", "unknown"]),
});

class DraftValidationError extends Error {
  constructor(message: string, readonly issues: string[]) { super(message); }
}

export async function runAutomaticProcessing(classificationIdInput: unknown, provider: AIProvider, db: PrismaClient = getDb()) {
  const context = await loadClassificationContext(idSchema.parse(classificationIdInput), db);
  if (isTerminalProcessing(context.processingStatus)) throw new WorkflowConflictError();
  const classificationId = context.id;
  const category = effectiveCategory(context);

  if (context.reviewStatus === "PENDING") {
    return finishRoute(context, "MANUAL_REVIEW", "WAITING_FOR_REVIEW", "Classification requires a human decision.", db);
  }
  if (category === "TECHNICAL_ISSUE") {
    return finishRoute(context, "TECHNICAL_QUEUE", "TECHNICAL_QUEUED", "Technical issues route to the technical queue.", db);
  }
  if (category === "MANUAL_REVIEW") {
    return finishRoute(context, "MANUAL_REVIEW", "WAITING_FOR_REVIEW", "The classifier explicitly requested manual handling.", db);
  }
  if (category === "IRRELEVANT_SPAM") {
    return finishRoute(context, "NO_ACTION", "NO_ACTION", "Likely irrelevant or spam; no reply draft was created.", db);
  }
  if (category !== "KNOWN_QUESTION" && category !== "UNKNOWN_QUESTION") {
    return finishRoute(context, "HUMAN_ANSWER_QUEUE", "AWAITING_HUMAN_ANSWER", "This category needs a human-authored answer in the MVP.", db);
  }

  const query = buildKnowledgeQuery(context.thread.subject, context.message.cleanBody.trim() || context.message.normalizedBody.trim());
  const noKnowledge = () => finishRoute(context, "HUMAN_ANSWER_QUEUE", "NO_KNOWLEDGE",
    "No sufficiently relevant Active Knowledge matched; a human answer is required.", db, query);
  if (query.length < 2) return noKnowledge();
  const language = context.aiLanguage === "fr" || context.aiLanguage === "en" ? context.aiLanguage : "ALL";
  const matches = await searchActiveKnowledge({ q: query, language, category, limit: 8 }, db);
  const match = selectGroundingMatch(query, matches);
  if (!match) return noKnowledge();
  const { entry: knowledge, revision: knowledgeRevision } = await captureApprovedKnowledge(match.id, db);
  // Bind exactly the same content selected by retrieval, before sending it to AI.
  if (knowledge.answer !== match.answer || knowledge.canonicalQuestion !== match.canonicalQuestion || knowledge.title !== match.title
    || knowledge.language !== match.language || knowledge.category !== match.category) {
    throw new WorkflowConflictError();
  }
  const fingerprint = knowledgeFingerprint(knowledge);
  const inputSnapshot = captureDraftInput(context, [knowledgeRevision.id]);
  const startedAt = performance.now();
  let executionMetadata: AIExecutionMetadata | undefined;
  try {
    let output: unknown;
    try {
      output = await provider.generateDraft({
        subject: inputSnapshot.subject,
        cleanBody: inputSnapshot.cleanBody,
        language: inputSnapshot.language,
        knowledge: [{ id: knowledge.id, title: knowledgeRevision.title, answer: knowledgeRevision.answer }],
        style: "DORIAN_REFERENCE",
      });
    } catch {
      throw new Error("Draft generation failed. The previous reply was preserved; retry automatic processing.");
    }
    executionMetadata = provider.getExecutionMetadata?.(output);
    const validated = draftResultSchema.safeParse(output);
    if (!validated.success) throw new DraftValidationError("Draft output failed validation.",
      validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
    if (validated.data.knowledgeSourceIds.some((id) => id !== knowledge.id)) {
      throw new DraftValidationError("Draft output failed grounding validation.", ["knowledgeSourceIds: contains an untrusted source"]);
    }
    return await workflowTransaction(db, async (transaction) => {
      await assertCurrentContext(context, transaction);
      const currentKnowledge = await transaction.knowledgeEntry.findUnique({ where: { id: knowledge.id } });
      if (!currentKnowledge || currentKnowledge.status !== "ACTIVE" || knowledgeFingerprint(currentKnowledge) !== fingerprint
        || currentKnowledge.currentRevisionId !== knowledgeRevision.id || !sameKnowledgeFacts(currentKnowledge, knowledgeRevision)) {
        throw new WorkflowConflictError();
      }
      await transaction.classification.update({
        where: { id: classificationId, revision: context.revision },
        data: {
          revision: { increment: 1 }, route: "KNOWN_KNOWLEDGE", processingStatus: "DRAFT_READY",
          knowledgeQuery: query, knowledgeMatchCount: 1,
          routingReason: "One sufficiently relevant Active Knowledge entry produced a grounded reference reply.",
        },
      });
      const execution = await transaction.aIExecution.create({
        data: {
          taskType: "DRAFT_GENERATION", provider: provider.id, model: provider.model,
          promptVersion: provider.draftPromptVersion, status: "SUCCEEDED", latencyMs: elapsed(startedAt),
          inputTokens: executionMetadata?.inputTokens, outputTokens: executionMetadata?.outputTokens,
          inputMetadata: { classificationId, sourceContextHash: context.sourceContextHash,
            knowledgeSourceIds: validated.data.knowledgeSourceIds, knowledgeRevisionIds: [knowledgeRevision.id],
            style: "DORIAN_REFERENCE", ...providerResponseMetadata(executionMetadata) },
          output: validated.data,
        },
      });
      const draft = await transaction.draft.create({
        data: {
          threadId: context.threadId, classificationId, classificationRevision: context.revision + 1,
          evidenceStatus: "CAPTURED", inputSnapshot,
          aiExecutionId: execution.id, subject: validated.data.subject, body: validated.data.body,
          language: validated.data.language, style: "DORIAN_REFERENCE",
          mode: provider.id === "mock" ? "MOCK_GROUNDED" : "AI_GROUNDED",
          knowledgeSources: { create: { knowledgeEntryId: knowledge.id, knowledgeRevisionId: knowledgeRevision.id,
            rank: 1, relevanceScore: match.score, knowledgeFingerprint: fingerprint } },
        },
      });
      await transaction.draft.updateMany({
        where: { classificationId, status: "GENERATED", id: { not: draft.id } },
        data: { status: "SUPERSEDED" },
      });
      await transaction.emailThread.update({ where: { id: context.threadId }, data: { status: "AWAITING_SEND_CONFIRMATION" } });
      return draft;
    });
  } catch (error) {
    await recordDraftFailure(context, provider, error, elapsed(startedAt), db, executionMetadata);
    throw error;
  }
}

export async function runThreadAutomation(threadId: unknown, provider: AIProvider, db: PrismaClient = getDb()) {
  const { runThreadClassification } = await import("@/lib/classification/service");
  const classification = await runThreadClassification(threadId, provider, db);
  await runAutomaticProcessing(classification.id, provider, db);
  return db.classification.findUniqueOrThrow({ where: { id: classification.id } });
}

export async function correctAndResumeProcessing(input: unknown, provider: AIProvider, db: PrismaClient = getDb()) {
  const reviewed = await reviewClassification(input, db);
  await runAutomaticProcessing(reviewed.id, provider, db);
  return reviewed;
}

export async function confirmAndSimulateSend(input: unknown, db: PrismaClient = getDb()) {
  const approved = confirmedDraftSchema.parse(input);
  const now = new Date();
  return workflowTransaction(db, async (transaction) => {
    const draft = await transaction.draft.findUnique({
      where: { id: approved.draftId }, include: { knowledgeSources: { include: { knowledgeEntry: true, knowledgeRevision: true } } },
    });
    if (!draft || draft.status !== "GENERATED") throw new Error("This reference reply is no longer ready to send.");
    const context = await loadClassificationContext(draft.classificationId, transaction);
    const snapshot = draftInputSnapshotSchema.safeParse(draft.inputSnapshot);
    if (context.processingStatus !== "DRAFT_READY" || draft.classificationRevision !== context.revision
      || draft.evidenceStatus !== "CAPTURED" || draft.knowledgeReviewRequiredAt !== null
      || !snapshot.success || snapshot.data.kind !== "GROUNDED"
      || snapshot.data.sourceContextHash !== context.sourceContextHash
      || snapshot.data.classificationRevisionAtStart + 1 !== draft.classificationRevision
      || snapshot.data.factualGrounding.revisionIds.length !== draft.knowledgeSources.length
      || draft.knowledgeSources.some((source) => !snapshot.data.factualGrounding.revisionIds.includes(source.knowledgeRevisionId ?? ""))
      || !validGrounding(draft.knowledgeSources)) throw new WorkflowConflictError();
    await transaction.classification.update({
      where: { id: context.id, revision: context.revision },
      data: { processingStatus: "SIMULATED_SENT", revision: { increment: 1 } },
    });
    const result = await transaction.draft.update({
      where: { id: approved.draftId, status: "GENERATED" },
      data: { status: "SIMULATED_SENT", approvedSubject: approved.subject, approvedBody: approved.body,
        approvedLanguage: approved.language, approvedAt: now, simulatedSentAt: now },
    });
    await transaction.emailThread.update({ where: { id: draft.threadId }, data: { status: "SIMULATED_SENT" } });
    return result;
  });
}

export async function simulateForwardToDiscord(classificationIdInput: unknown, db: PrismaClient = getDb()) {
  return workflowTransaction(db, async (transaction) => {
    const context = await loadClassificationContext(idSchema.parse(classificationIdInput), transaction);
    if (context.processingStatus !== "TECHNICAL_QUEUED") throw new Error("This thread is no longer ready for technical forwarding.");
    const updated = await transaction.classification.update({
      where: { id: context.id, revision: context.revision },
      data: { processingStatus: "SIMULATED_FORWARDED", simulatedForwardedAt: new Date(), revision: { increment: 1 } },
    });
    await transaction.emailThread.update({ where: { id: context.threadId }, data: { status: "SIMULATED_FORWARDED" } });
    return updated;
  });
}

export async function submitManualAnswer(input: unknown, db: PrismaClient = getDb()) {
  const answer = manualAnswerSchema.parse(input);
  return workflowTransaction(db, async (transaction) => {
    const context = await loadClassificationContext(answer.classificationId, transaction);
    if (context.revision !== answer.expectedRevision) throw new WorkflowConflictError();
    if (context.processingStatus !== "AWAITING_HUMAN_ANSWER" && context.processingStatus !== "NO_KNOWLEDGE") {
      throw new Error("This thread is no longer waiting for a human answer.");
    }
    const now = new Date();
    const subject = /^re:/iu.test(context.thread.subject) ? context.thread.subject : `Re: ${context.thread.subject}`;
    await transaction.classification.update({
      where: { id: context.id, revision: answer.expectedRevision },
      data: { processingStatus: "SIMULATED_SENT", revision: { increment: 1 } },
    });
    const draft = await transaction.draft.create({
      data: {
        threadId: context.threadId, classificationId: context.id, classificationRevision: context.revision + 1,
        evidenceStatus: "HUMAN_AUTHORED", inputSnapshot: captureDraftInput(context, []),
        subject, body: answer.body, language: context.aiLanguage, style: "HUMAN_AUTHORED", mode: "MANUAL",
        status: "SIMULATED_SENT", approvedSubject: subject, approvedBody: answer.body,
        approvedLanguage: context.aiLanguage, approvedAt: now, simulatedSentAt: now,
      },
    });
    if (answer.createCandidate) {
      await transaction.knowledgeCandidate.create({
        data: {
          fingerprint: `manual-answer:${context.id}`, title: context.thread.subject,
          canonicalQuestion: (context.message.cleanBody.trim() || context.message.normalizedBody.trim()).slice(0, 2000),
          proposedAnswer: answer.body, category: effectiveCategory(context), language: context.aiLanguage,
          sources: { create: { sourceKey: `manual-answer:${context.id}:${context.message.id}`, sourceType: "EMAIL",
            emailMessageId: context.message.id, sourceLabel: context.thread.subject,
            sourceExcerpt: (context.message.cleanBody.trim() || context.message.normalizedBody.trim()).slice(0, 1000) } },
        },
      });
    }
    await transaction.emailThread.update({ where: { id: context.threadId }, data: { status: "SIMULATED_SENT" } });
    return draft;
  });
}

function effectiveCategory(context: { aiCategory: ClassificationCategory; reviewedCategory: ClassificationCategory | null }) {
  return context.reviewedCategory ?? context.aiCategory;
}

export function buildKnowledgeQuery(subject: string, body: string) {
  const questionSegments = body
    .replaceAll(/\s+/gu, " ")
    .split(/(?<=[?!.])\s+/u)
    .filter((segment) => QUESTION_CUE_PATTERN.test(segment));
  const primaryText = questionSegments.length ? questionSegments.join(" ") : body;
  const primaryTerms = meaningfulTerms(primaryText);
  const useful = primaryTerms.length ? primaryTerms : meaningfulTerms(subject);
  return useful.slice(0, 8).join(" OR ").slice(0, 500);
}

export function selectGroundingMatch<
  T extends { canonicalQuestion: string; answer: string; score: number },
>(query: string, matches: T[]): T | null {
  const queryTerms = new Set(
    meaningfulTerms(query.replaceAll(" OR ", " ")).map(termKey),
  );
  if (queryTerms.size < 2) return null;

  const ranked = matches
    .map((match) => {
      const questionTerms = new Set(meaningfulTerms(match.canonicalQuestion).map(termKey));
      const answerTerms = new Set(meaningfulTerms(match.answer).map(termKey));
      const questionOverlap = [...queryTerms].filter((term) => questionTerms.has(term));
      const answerOverlap = [...queryTerms].filter((term) => answerTerms.has(term));
      const totalOverlap = new Set([...questionOverlap, ...answerOverlap]).size;
      return { match, questionOverlap: questionOverlap.length, totalOverlap };
    })
    .filter((candidate) => candidate.questionOverlap >= 2)
    .sort((left, right) =>
      right.totalOverlap - left.totalOverlap
      || right.questionOverlap - left.questionOverlap
      || right.match.score - left.match.score,
    );

  return ranked[0]?.match ?? null;
}

const QUESTION_CUE_PATTERN = /\?|\b(?:how|what|why|when|where|which|can you|could you|please explain|tell me|comment|pourquoi|quand|où|quel(?:le|s|les)?|combien|est-ce|pouvez-vous|peux-tu|pourriez-vous|expliquez-moi)\b/iu;

const IGNORED_KNOWLEDGE_TERMS = new Set([
  "about", "after", "again", "avec", "avais", "avant", "avoir", "bonjour",
  "can", "comment", "could", "dernier", "dorian", "does", "email", "est-ce",
  "explain", "gallery", "galerie", "hello", "merci", "notre", "original", "oeuvre",
  "artist", "artiste", "artwork", "please", "pour", "pourriez", "question",
  "rappel", "salut", "should", "tell", "that", "this", "votre", "vous",
  "what", "when", "where", "which", "would", "your",
]);

function meaningfulTerms(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replaceAll("œ", "oe")
    .toLocaleLowerCase();
  const terms = normalized.match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return [...new Set(terms.filter((term) => !IGNORED_KNOWLEDGE_TERMS.has(termKey(term))))];
}

function termKey(value: string) {
  return value.normalize("NFKD").replaceAll(/\p{M}/gu, "");
}

async function finishRoute(
  context: ClassificationContext,
  route: "KNOWN_KNOWLEDGE" | "TECHNICAL_QUEUE" | "HUMAN_ANSWER_QUEUE" | "MANUAL_REVIEW" | "NO_ACTION",
  processingStatus: "WAITING_FOR_REVIEW" | "TECHNICAL_QUEUED" | "AWAITING_HUMAN_ANSWER" | "NO_ACTION" | "NO_KNOWLEDGE",
  routingReason: string,
  db: PrismaClient,
  knowledgeQuery: string | null = null,
) {
  return workflowTransaction(db, async (transaction) => {
    await assertCurrentContext(context, transaction);
    const result = await transaction.classification.update({
      where: { id: context.id, revision: context.revision },
      data: { revision: { increment: 1 }, route, processingStatus, routingReason, knowledgeQuery, knowledgeMatchCount: 0 },
    });
    await transaction.draft.updateMany({ where: { classificationId: context.id, status: "GENERATED" }, data: { status: "SUPERSEDED" } });
    await transaction.emailThread.update({ where: { id: context.threadId }, data: { status: processingStatus } });
    return result;
  });
}

function validGrounding(sources: VersionedGrounding[]) {
  return sources.length > 0 && sources.every((source) => source.knowledgeEntry.status === "ACTIVE"
    && source.knowledgeRevision !== null && source.knowledgeRevisionId === source.knowledgeEntry.currentRevisionId
    && source.knowledgeRevision.knowledgeEntryId === source.knowledgeEntry.id
    && sameKnowledgeFacts(source.knowledgeEntry, source.knowledgeRevision)
    && source.knowledgeFingerprint !== null && source.knowledgeFingerprint === knowledgeFingerprint(source.knowledgeEntry));
}

async function recordDraftFailure(context: ClassificationContext, provider: AIProvider, error: unknown,
  latencyMs: number, db: PrismaClient, executionMetadata?: AIExecutionMetadata) {
  const conflict = error instanceof WorkflowConflictError;
  await db.aIExecution.create({
    data: {
      taskType: "DRAFT_GENERATION", provider: provider.id, model: provider.model,
      promptVersion: provider.draftPromptVersion, status: "FAILED", latencyMs,
      inputTokens: executionMetadata?.inputTokens, outputTokens: executionMetadata?.outputTokens,
      inputMetadata: { classificationId: context.id, classificationRevision: context.revision, ...providerResponseMetadata(executionMetadata) },
      validationErrors: conflict ? ["STALE_CONTEXT"] : error instanceof DraftValidationError ? error.issues : [],
      errorMessage: conflict ? "Draft result discarded because its context changed." : "Draft generation or validation failed; previous content was preserved.",
    },
  });
  if (conflict) return;
  try {
    await workflowTransaction(db, async (transaction) => {
      await assertCurrentContext(context, transaction);
      const previous = await transaction.draft.findFirst({
        where: { classificationId: context.id, classificationRevision: context.revision, status: "GENERATED" },
        include: { knowledgeSources: { include: { knowledgeEntry: true, knowledgeRevision: true } } },
      });
      const preserved = previous && previous.evidenceStatus === "CAPTURED"
        && previous.knowledgeReviewRequiredAt === null && validGrounding(previous.knowledgeSources);
      await transaction.classification.update({
        where: { id: context.id, revision: context.revision },
        data: { processingStatus: preserved ? "DRAFT_READY" : "FAILED",
          routingReason: preserved ? "The replacement failed. The previous grounded reply remains available for review." : "Draft generation failed. Retry automatic processing." },
      });
      await transaction.emailThread.update({ where: { id: context.threadId },
        data: { status: preserved ? "AWAITING_SEND_CONFIRMATION" : "AUTOMATIC_PROCESSING_FAILED" } });
    });
  } catch (failure) {
    if (!(failure instanceof WorkflowConflictError)) throw failure;
    // A newer success, correction, or confirmation must not be overwritten by a late failure.
  }
}

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function providerResponseMetadata(metadata?: AIExecutionMetadata) {
  if (!metadata) return {};
  return {
    providerResponse: {
      ...(metadata.totalTokens !== undefined ? { totalTokens: metadata.totalTokens } : {}),
      ...(metadata.thoughtsTokens !== undefined ? { thoughtsTokens: metadata.thoughtsTokens } : {}),
      ...(metadata.modelVersion ? { modelVersion: metadata.modelVersion } : {}),
      ...(metadata.responseId ? { responseId: metadata.responseId } : {}),
      ...(metadata.finishReason ? { finishReason: metadata.finishReason } : {}),
    },
  };
}
