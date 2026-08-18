import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { cleanKnowledgeCandidate } from "@/lib/knowledge/candidate-cleaner";
import { websiteFaqCatalog } from "@/lib/knowledge/website-faq-catalog";

const websiteCapturedAt = new Date("2026-08-17T00:00:00.000Z");

export function detectCandidateLanguage(text: string): "fr" | "en" | "unknown" {
  const normalized = ` ${text.toLocaleLowerCase()} `;
  const frenchSignals = [" le ", " la ", " les ", " des ", " une ", " est ", " vous ", " votre ", " pour ", " avec ", " bonjour "];
  const englishSignals = [" the ", " a ", " an ", " is ", " you ", " your ", " for ", " with ", " hello ", " please "];
  const score = (signals: string[]) =>
    signals.reduce((total, signal) => total + (normalized.includes(signal) ? 1 : 0), 0);
  const frenchScore = score(frenchSignals) + (/[àâçéèêëîïôùûüÿœ]/i.test(text) ? 2 : 0);
  const englishScore = score(englishSignals);
  if (frenchScore === englishScore) return "unknown";
  return frenchScore > englishScore ? "fr" : "en";
}

export async function importKnowledgeCandidates(db: PrismaClient = getDb()) {
  const approvedMessages = await db.emailMessage.findMany({
    where: {
      direction: "OUTBOUND",
      knowledgeSourceStatus: "READY_FOR_REVIEW",
      knowledgeReviewStatus: "APPROVED",
      cleanBody: { not: "" },
    },
    select: {
      id: true,
      subject: true,
      cleanBody: true,
      quotedContext: true,
      sentAt: true,
      participants: { select: { displayName: true } },
    },
  });

  for (const message of approvedMessages) {
    const fingerprint = `email:${message.id}`;
    const title = stripReplyPrefix(message.subject) || "Historical email answer";
    const cleaned = cleanKnowledgeCandidate({
      title,
      canonicalQuestion:
        message.quotedContext?.trim() || `Historical inquiry related to: ${title}`,
      proposedAnswer: message.cleanBody,
      knownNames: message.participants.flatMap((participant) =>
        participant.displayName ? [participant.displayName] : [],
      ),
    });
    const candidate = await db.knowledgeCandidate.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        title,
        canonicalQuestion: cleaned.canonicalQuestion,
        proposedAnswer: cleaned.proposedAnswer,
        category: "HISTORICAL_EMAIL",
        language: detectCandidateLanguage(
          `${message.quotedContext ?? ""}\n${message.cleanBody}`,
        ),
      },
      update: {},
      select: { id: true },
    });

    await db.knowledgeCandidateSource.upsert({
      where: { sourceKey: fingerprint },
      create: {
        sourceKey: fingerprint,
        candidateId: candidate.id,
        sourceType: "EMAIL",
        emailMessageId: message.id,
        sourceLabel: message.subject,
        sourceExcerpt: message.quotedContext?.trim() || message.cleanBody,
      },
      update: {},
    });
  }

  for (const faq of websiteFaqCatalog) {
    const source = await db.websiteSource.upsert({
      where: { url: faq.sourceUrl },
      create: {
        url: faq.sourceUrl,
        title: faq.sourceTitle,
        language: faq.language,
        capturedAt: websiteCapturedAt,
      },
      update: { title: faq.sourceTitle },
      select: { id: true },
    });
    const fingerprint = `website-faq:${faq.key}`;
    const candidate = await db.knowledgeCandidate.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        title: faq.title,
        canonicalQuestion: faq.canonicalQuestion,
        proposedAnswer: faq.proposedAnswer,
        category: faq.category,
        language: faq.language,
      },
      update: {},
      select: { id: true },
    });

    await db.knowledgeCandidateSource.upsert({
      where: { sourceKey: fingerprint },
      create: {
        sourceKey: fingerprint,
        candidateId: candidate.id,
        sourceType: "WEBSITE",
        websiteSourceId: source.id,
        sourceLabel: `${faq.sourceTitle} — ${faq.sectionHeading}`,
        sourceExcerpt: `${faq.canonicalQuestion}\n${faq.proposedAnswer}`,
      },
      update: {},
    });
  }

  return {
    approvedEmailCandidates: approvedMessages.length,
    websiteFaqCandidates: websiteFaqCatalog.length,
    total: approvedMessages.length + websiteFaqCatalog.length,
    catalogDigest: createHash("sha256")
      .update(JSON.stringify(websiteFaqCatalog))
      .digest("hex"),
  };
}

function stripReplyPrefix(subject: string) {
  return subject.replace(/^\s*(re|rép|aw|sv)\s*:\s*/i, "").trim();
}
