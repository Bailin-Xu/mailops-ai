import { z } from "zod";
import type { ClassificationContext } from "@/lib/workflow/context";

const inputBase = {
  schemaVersion: z.literal(1), threadId: z.string().uuid(), classificationId: z.string().uuid(),
  classificationRevisionAtStart: z.number().int().nonnegative(), inboundMessageId: z.string().uuid(),
  sourceContextHash: z.string().regex(/^[a-f0-9]{64}$/u),
  subject: z.string(), cleanBody: z.string(), language: z.enum(["en", "fr", "mixed", "unknown"]),
};
export const draftInputSnapshotSchema = z.discriminatedUnion("kind", [
  z.object({ ...inputBase, kind: z.literal("GROUNDED"),
    factualGrounding: z.object({ revisionIds: z.array(z.string().uuid()).min(1) }),
    style: z.object({ profile: z.literal("DORIAN_REFERENCE") }),
  }),
  z.object({ ...inputBase, kind: z.literal("HUMAN_AUTHORED"),
    factualGrounding: z.object({ revisionIds: z.array(z.string().uuid()).length(0) }),
    style: z.object({ profile: z.literal("HUMAN_AUTHORED") }),
  }),
]);

export function captureDraftInput(context: ClassificationContext, revisionIds: string[]) {
  return draftInputSnapshotSchema.parse({
    schemaVersion: 1, threadId: context.threadId, classificationId: context.id,
    classificationRevisionAtStart: context.revision, inboundMessageId: context.message.id,
    sourceContextHash: context.sourceContextHash, subject: context.thread.subject,
    cleanBody: context.message.cleanBody.trim() || context.message.normalizedBody.trim(),
    language: context.aiLanguage, kind: revisionIds.length ? "GROUNDED" : "HUMAN_AUTHORED",
    factualGrounding: { revisionIds },
    style: { profile: revisionIds.length ? "DORIAN_REFERENCE" : "HUMAN_AUTHORED" },
  });
}
