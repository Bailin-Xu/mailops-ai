import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { PrismaClient } from "../../generated/prisma/client";
import { ingestEml } from "../../lib/email/ingestion";
import { ensureCurrentKnowledgeRevision } from "../../lib/knowledge/revisions";
import { workflowTransaction } from "../../lib/workflow/transaction";

export const demoCandidatePrefix = "neutral-demo:v1:";
export const demoMessageIds = ["shipping-en", "shipping-fr", "technical-en", "manual-fr"]
  .map((key) => `neutral-demo-v1-${key}@example.test`);

const knowledge = [
  {
    key: "shipping-en",
    title: "Tracked delivery",
    canonicalQuestion: "How does tracked shipping delivery work for an order?",
    answer: "Orders use tracked shipping. The tracking link is included in the dispatch confirmation.",
    language: "en",
  },
  {
    key: "shipping-fr",
    title: "Livraison avec suivi",
    canonicalQuestion: "Comment fonctionne la livraison avec suivi pour une commande ?",
    answer: "Les commandes sont expédiées avec suivi. Le lien de suivi figure dans la confirmation d'expédition.",
    language: "fr",
  },
] as const;

/** Explicitly invoked, pre-approved synthetic fixture data; no AI approval or calls. */
export async function seedNeutralDemo(db: PrismaClient) {
  const approvedAt = new Date("2026-10-27T12:00:00.000Z");
  for (const entry of knowledge) {
    const fields = {
      title: entry.title,
      canonicalQuestion: entry.canonicalQuestion,
      answer: entry.answer,
      category: "SHIPPING",
      language: entry.language,
    };
    await workflowTransaction(db, async (transaction) => {
      const candidate = await transaction.knowledgeCandidate.upsert({
        where: { fingerprint: `${demoCandidatePrefix}${entry.key}` },
        include: { knowledgeEntry: true },
        update: {}, // Never overwrite subsequent reviewer edits, rejection, or retirement.
        create: {
          fingerprint: `${demoCandidatePrefix}${entry.key}`,
          title: fields.title,
          canonicalQuestion: fields.canonicalQuestion,
          proposedAnswer: fields.answer,
          category: fields.category,
          language: fields.language,
          status: "APPROVED",
          reviewedTitle: fields.title,
          reviewedQuestion: fields.canonicalQuestion,
          reviewedAnswer: fields.answer,
          reviewedCategory: fields.category,
          reviewedLanguage: fields.language,
          reviewNote: "Pre-approved synthetic demo fixture; not operational company knowledge.",
          reviewedAt: approvedAt,
          reviewEvents: {
            create: {
              decision: "APPROVED",
              reviewedTitle: fields.title,
              reviewedQuestion: fields.canonicalQuestion,
              reviewedAnswer: fields.answer,
              reviewedCategory: fields.category,
              reviewedLanguage: fields.language,
              note: "Pre-approved synthetic demo fixture; no AI approval occurred.",
              createdAt: approvedAt,
            },
          },
          knowledgeEntry: { create: { ...fields, status: "ACTIVE", approvedAt } },
        },
      });
      if (candidate.knowledgeEntry) await ensureCurrentKnowledgeRevision(candidate.knowledgeEntry, transaction, "SYNTHETIC_FIXTURE");
    });
  }

  const counts = { imported: 0, duplicate: 0 };
  for (const key of ["shipping-en", "shipping-fr", "technical-en", "manual-fr"]) {
    const fileName = `${key}.eml`;
    const input = await readFile(resolve("tests/fixtures/eml/neutral-demo", fileName));
    const result = await ingestEml(input, fileName, {
      db,
      ownedAddresses: ["support@example.test"],
    });
    if (result.status === "failed") throw new Error("Synthetic demo email import failed.");
    counts[result.status] += 1;
  }
  return counts;
}
