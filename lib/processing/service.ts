import type {
  ClassificationCategory,
  PrismaClient,
} from "@/generated/prisma/client";
import {
  draftResultSchema,
  type AIProvider,
} from "@/lib/ai/provider";
import { reviewClassification } from "@/lib/classification/service";
import { getDb } from "@/lib/db";
import { searchActiveKnowledge } from "@/lib/knowledge/search";
import { z } from "zod";

const idSchema = z.string().uuid();
const manualAnswerSchema = z.object({
  classificationId: z.string().uuid(),
  body: z.string().trim().min(1).max(20_000),
  createCandidate: z.boolean().default(false),
});

export async function runAutomaticProcessing(
  classificationIdInput: unknown,
  provider: AIProvider,
  db: PrismaClient = getDb(),
) {
  const classificationId = idSchema.parse(classificationIdInput);
  const context = await loadContext(classificationId, db);
  const category = effectiveCategory(context);

  await db.draft.updateMany({
    where: { classificationId, status: "GENERATED" },
    data: { status: "SUPERSEDED" },
  });

  if (context.reviewStatus === "PENDING") {
    return setRoute(classificationId, "MANUAL_REVIEW", "WAITING_FOR_REVIEW", "Confidence is below the 70% automatic-routing threshold.", db);
  }

  if (category === "TECHNICAL_ISSUE") {
    return setRoute(classificationId, "TECHNICAL_QUEUE", "TECHNICAL_QUEUED", "Technical issues route to the technical queue.", db);
  }
  if (category === "UNKNOWN_QUESTION") {
    return setRoute(classificationId, "HUMAN_ANSWER_QUEUE", "AWAITING_HUMAN_ANSWER", "No known-answer claim is allowed for an unknown question.", db);
  }
  if (category === "MANUAL_REVIEW") {
    return setRoute(classificationId, "MANUAL_REVIEW", "WAITING_FOR_REVIEW", "The classifier explicitly requested manual handling.", db);
  }
  if (category === "IRRELEVANT_SPAM") {
    return setRoute(classificationId, "NO_ACTION", "NO_ACTION", "Likely irrelevant or spam; no reply draft was created.", db);
  }
  if (category !== "KNOWN_QUESTION") {
    return setRoute(classificationId, "HUMAN_ANSWER_QUEUE", "AWAITING_HUMAN_ANSWER", "This category needs a human-authored answer in the MVP.", db);
  }

  const query = buildKnowledgeQuery(context.thread.subject, context.message.cleanBody || context.message.normalizedBody);
  await db.classification.update({
    where: { id: classificationId },
    data: {
      route: "KNOWN_KNOWLEDGE",
      processingStatus: "SEARCHING_KNOWLEDGE",
      routingReason: "Known questions search Active Knowledge automatically.",
      knowledgeQuery: query,
    },
  });

  if (query.length < 2) {
    return db.classification.update({
      where: { id: classificationId },
      data: {
        processingStatus: "NO_KNOWLEDGE",
        knowledgeMatchCount: 0,
        routingReason: "No specific question terms were available for a safe knowledge search; a human answer is required.",
      },
    });
  }

  const language = context.aiLanguage === "fr" || context.aiLanguage === "en"
    ? context.aiLanguage
    : "ALL";
  const matches = await searchActiveKnowledge({
    q: query,
    language,
    category,
    limit: 8,
  }, db);
  const groundingMatch = selectGroundingMatch(query, matches);

  if (!groundingMatch) {
    return db.classification.update({
      where: { id: classificationId },
      data: {
        processingStatus: "NO_KNOWLEDGE",
        knowledgeMatchCount: 0,
        routingReason: "No sufficiently relevant Active Knowledge matched; a human answer is required.",
      },
    });
  }

  const startedAt = performance.now();
  let output: unknown;
  try {
    output = await provider.generateDraft({
      subject: context.thread.subject,
      cleanBody: context.message.cleanBody || context.message.normalizedBody,
      language: context.aiLanguage as "en" | "fr" | "mixed" | "unknown",
      knowledge: [groundingMatch].map(({ id, title, answer }) => ({ id, title, answer })),
      style: "DORIAN_REFERENCE",
    });
  } catch {
    await recordDraftFailure(classificationId, provider, "The draft provider failed.", [], elapsed(startedAt), db);
    throw new Error("Draft generation failed. Retry automatic processing.");
  }

  const validated = draftResultSchema.safeParse(output);
  if (!validated.success) {
    const errors = validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    await recordDraftFailure(classificationId, provider, "The provider returned an invalid draft.", errors, elapsed(startedAt), db);
    throw new Error("Draft output failed validation.");
  }

  const allowedIds = new Set([groundingMatch.id]);
  if (validated.data.knowledgeSourceIds.some((id) => !allowedIds.has(id))) {
    await recordDraftFailure(classificationId, provider, "The draft cited knowledge that was not supplied.", ["knowledgeSourceIds: contains an untrusted source"], elapsed(startedAt), db);
    throw new Error("Draft output failed grounding validation.");
  }

  return db.$transaction(async (transaction) => {
    const execution = await transaction.aIExecution.create({
      data: {
        taskType: "DRAFT_GENERATION",
        provider: provider.id,
        model: provider.model,
        promptVersion: provider.draftPromptVersion,
        status: "SUCCEEDED",
        latencyMs: elapsed(startedAt),
        inputMetadata: {
          classificationId,
          knowledgeSourceIds: validated.data.knowledgeSourceIds,
          style: "DORIAN_REFERENCE",
        },
        output: validated.data,
      },
    });
    const draft = await transaction.draft.create({
      data: {
        threadId: context.threadId,
        classificationId,
        aiExecutionId: execution.id,
        subject: validated.data.subject,
        body: validated.data.body,
        language: validated.data.language,
        style: "DORIAN_REFERENCE",
        mode: "MOCK_GROUNDED",
        knowledgeSources: {
          create: [groundingMatch]
            .filter((match) => validated.data.knowledgeSourceIds.includes(match.id))
            .map((match, index) => ({
              knowledgeEntryId: match.id,
              rank: index + 1,
              relevanceScore: match.score,
            })),
        },
      },
    });
    await transaction.classification.update({
      where: { id: classificationId },
      data: {
        processingStatus: "DRAFT_READY",
        knowledgeMatchCount: 1,
        routingReason: "One sufficiently relevant Active Knowledge entry produced a grounded Dorian-style reference reply.",
      },
    });
    await transaction.emailThread.update({
      where: { id: context.threadId },
      data: { status: "AWAITING_SEND_CONFIRMATION" },
    });
    return draft;
  });
}

export async function runThreadAutomation(
  threadId: unknown,
  provider: AIProvider,
  db: PrismaClient = getDb(),
) {
  const { runThreadClassification } = await import("@/lib/classification/service");
  const classification = await runThreadClassification(threadId, provider, db);
  await runAutomaticProcessing(classification.id, provider, db);
  return db.classification.findUniqueOrThrow({ where: { id: classification.id } });
}

export async function correctAndResumeProcessing(
  input: unknown,
  provider: AIProvider,
  db: PrismaClient = getDb(),
) {
  const reviewed = await reviewClassification(input, db);
  await runAutomaticProcessing(reviewed.id, provider, db);
  return reviewed;
}

export async function confirmAndSimulateSend(
  draftIdInput: unknown,
  db: PrismaClient = getDb(),
) {
  const draftId = idSchema.parse(draftIdInput);
  const draft = await db.draft.findUnique({ where: { id: draftId } });
  if (!draft || draft.status !== "GENERATED") throw new Error("This reference reply is no longer ready to send.");
  const now = new Date();
  return db.$transaction(async (transaction) => {
    const sent = await transaction.draft.update({
      where: { id: draftId },
      data: {
        status: "SIMULATED_SENT",
        approvedSubject: draft.subject,
        approvedBody: draft.body,
        approvedAt: now,
        simulatedSentAt: now,
      },
    });
    await transaction.classification.update({
      where: { id: draft.classificationId },
      data: { processingStatus: "SIMULATED_SENT" },
    });
    await transaction.emailThread.update({
      where: { id: draft.threadId },
      data: { status: "SIMULATED_SENT" },
    });
    return sent;
  });
}

export async function simulateForwardToDiscord(
  classificationIdInput: unknown,
  db: PrismaClient = getDb(),
) {
  const classificationId = idSchema.parse(classificationIdInput);
  const current = await db.classification.findUnique({ where: { id: classificationId } });
  if (!current || current.processingStatus !== "TECHNICAL_QUEUED") {
    throw new Error("This thread is no longer ready for technical forwarding.");
  }
  return db.classification.update({
    where: { id: classificationId },
    data: { processingStatus: "SIMULATED_FORWARDED", simulatedForwardedAt: new Date() },
  });
}

export async function submitManualAnswer(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const answer = manualAnswerSchema.parse(input);
  const context = await loadContext(answer.classificationId, db);
  if (context.processingStatus !== "AWAITING_HUMAN_ANSWER" && context.processingStatus !== "NO_KNOWLEDGE") {
    throw new Error("This thread is no longer waiting for a human answer.");
  }
  const now = new Date();
  const category = effectiveCategory(context);
  return db.$transaction(async (transaction) => {
    const draft = await transaction.draft.create({
      data: {
        threadId: context.threadId,
        classificationId: context.id,
        subject: /^re:/iu.test(context.thread.subject) ? context.thread.subject : `Re: ${context.thread.subject}`,
        body: answer.body,
        language: context.aiLanguage,
        style: "HUMAN_AUTHORED",
        mode: "MANUAL",
        status: "SIMULATED_SENT",
        approvedSubject: /^re:/iu.test(context.thread.subject) ? context.thread.subject : `Re: ${context.thread.subject}`,
        approvedBody: answer.body,
        approvedAt: now,
        simulatedSentAt: now,
      },
    });
    if (answer.createCandidate) {
      await transaction.knowledgeCandidate.create({
        data: {
          fingerprint: `manual-answer:${context.id}`,
          title: context.thread.subject,
          canonicalQuestion: (context.message.cleanBody || context.message.normalizedBody).slice(0, 2000),
          proposedAnswer: answer.body,
          category,
          language: context.aiLanguage,
          sources: {
            create: {
              sourceKey: `manual-answer:${context.id}:${context.message.id}`,
              sourceType: "EMAIL",
              emailMessageId: context.message.id,
              sourceLabel: context.thread.subject,
              sourceExcerpt: (context.message.cleanBody || context.message.normalizedBody).slice(0, 1000),
            },
          },
        },
      });
    }
    await transaction.classification.update({
      where: { id: context.id },
      data: { processingStatus: "SIMULATED_SENT" },
    });
    await transaction.emailThread.update({
      where: { id: context.threadId },
      data: { status: "SIMULATED_SENT" },
    });
    return draft;
  });
}

async function loadContext(classificationId: string, db: PrismaClient) {
  const classification = await db.classification.findUnique({
    where: { id: classificationId },
    include: {
      thread: {
        include: {
          messages: {
            where: { direction: "INBOUND" },
            orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
            take: 1,
          },
        },
      },
    },
  });
  if (!classification) throw new Error("The selected classification no longer exists.");
  const message = classification.thread.messages[0];
  if (!message) throw new Error("Only a thread with an inbound message can be processed.");
  return { ...classification, message };
}

function effectiveCategory(context: {
  aiCategory: ClassificationCategory;
  reviewedCategory: ClassificationCategory | null;
}) {
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

async function setRoute(
  id: string,
  route: "KNOWN_KNOWLEDGE" | "TECHNICAL_QUEUE" | "HUMAN_ANSWER_QUEUE" | "MANUAL_REVIEW" | "NO_ACTION",
  processingStatus: "WAITING_FOR_REVIEW" | "TECHNICAL_QUEUED" | "AWAITING_HUMAN_ANSWER" | "NO_ACTION",
  routingReason: string,
  db: PrismaClient,
) {
  return db.classification.update({
    where: { id },
    data: { route, processingStatus, routingReason, knowledgeQuery: null, knowledgeMatchCount: 0 },
  });
}

async function recordDraftFailure(
  classificationId: string,
  provider: AIProvider,
  errorMessage: string,
  validationErrors: string[],
  latencyMs: number,
  db: PrismaClient,
) {
  await db.$transaction([
    db.aIExecution.create({
      data: {
        taskType: "DRAFT_GENERATION",
        provider: provider.id,
        model: provider.model,
        promptVersion: provider.draftPromptVersion,
        status: "FAILED",
        latencyMs,
        inputMetadata: { classificationId },
        validationErrors,
        errorMessage,
      },
    }),
    db.classification.update({
      where: { id: classificationId },
      data: { processingStatus: "FAILED" },
    }),
  ]);
}

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
