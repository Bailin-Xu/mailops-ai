import type { Prisma } from "@/generated/prisma/client";
import type { AIProvider, AIExecutionMetadata, DraftResult } from "@/lib/ai/provider";
import { assertCurrentContext, knowledgeFingerprint, type ClassificationContext } from "@/lib/workflow/context";
import { WorkflowConflictError } from "@/lib/workflow/transaction";
import { sameKnowledgeFacts, type captureApprovedKnowledge } from "@/lib/knowledge/revisions";
import { captureDraftInput } from "./evidence";
type Knowledge = Awaited<ReturnType<typeof captureApprovedKnowledge>>;
export type GroundedCommit = {
 context: ClassificationContext; reviewToken: {id: string; reviewRevision: number} | null;
 knowledge: Knowledge["entry"]; knowledgeRevision: Knowledge["revision"]; fingerprint: string;
 inputSnapshot: ReturnType<typeof captureDraftInput>; validated: DraftResult;
 provider: Pick<AIProvider,"id" | "model" | "draftPromptVersion">;
 executionMetadata?: AIExecutionMetadata; query: string; latencyMs: number; relevanceScore?: number; extraMetadata?: Prisma.InputJsonObject;
};
export async function persistGroundedDraft(input: GroundedCommit, transaction: Prisma.TransactionClient) {
 const {context,reviewToken,knowledge,knowledgeRevision,fingerprint,inputSnapshot,validated,provider,executionMetadata,query,latencyMs}=input;
 const classificationId=context.id;
 const match={score:input.relevanceScore ?? 0};
      await assertCurrentContext(context, transaction);
      if (reviewToken) {
        const currentReview = await transaction.draft.findUnique({ where: { id: reviewToken.id }, select: { reviewRevision: true } });
        if (!currentReview || currentReview.reviewRevision !== reviewToken.reviewRevision) throw new WorkflowConflictError();
      }
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
          promptVersion: provider.draftPromptVersion, status: "SUCCEEDED", latencyMs: latencyMs,
          inputTokens: executionMetadata?.inputTokens, outputTokens: executionMetadata?.outputTokens,
          inputMetadata: { ...input.extraMetadata, classificationId, sourceContextHash: context.sourceContextHash,
            knowledgeSourceIds: validated.knowledgeSourceIds, knowledgeRevisionIds: [knowledgeRevision.id],
            style: "DORIAN_REFERENCE", ...providerResponseMetadata(executionMetadata) },
          output: validated,
        },
      });
      const draft = await transaction.draft.create({
        data: {
          threadId: context.threadId, classificationId, classificationRevision: context.revision + 1,
          evidenceStatus: "CAPTURED", inputSnapshot,
          aiExecutionId: execution.id, subject: validated.subject, body: validated.body,
          language: validated.language, style: "DORIAN_REFERENCE",
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
