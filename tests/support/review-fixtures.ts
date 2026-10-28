import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { resolveTestDatabaseUrl } from "./database-target.mjs";
import { saveCandidateReview } from "../../lib/knowledge/candidate-review";
import { MockAIProvider } from "../../lib/ai/mock-provider";
import { prepareThreadReconstruction } from "../../lib/email/reconstruction/plan";
import { applyThreadReconstruction } from "../../lib/email/reconstruction/apply";
import { runThreadAutomation } from "../../lib/processing/service";

export function syntheticFixtures() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl({ ...process.env, DATABASE_URL: process.env.MAILOPS_TEST_DEVELOPMENT_DATABASE_URL ?? process.env.DATABASE_URL }) }) });
  const candidateIds: string[] = [], threadIds: string[] = [], receipts: string[] = [];
  async function create({ language = "en", failure = false, preGenerate = false, label = "" }: { language?: "en" | "fr"; failure?: boolean; preGenerate?: boolean; label?: string } = {}) {
    const marker = `review${randomUUID().replaceAll("-", "")}`;
    const question = language === "fr" ? `Comment fonctionne la livraison ${marker} avec suivi pour une commande ?` : `How does ${marker} tracked shipping delivery work for an order?`;
    const answer = language === "fr" ? "Les commandes sont expédiées avec suivi. Le lien de suivi figure dans la confirmation." : "Orders use tracked shipping. The tracking link is included in the confirmation.";
    const title = `${label || "Synthetic shipping"} ${marker}`;
    const candidate = await db.knowledgeCandidate.create({ data: { fingerprint: randomUUID(), title, canonicalQuestion: question,
      proposedAnswer: answer, category: "SHIPPING", language } });
    candidateIds.push(candidate.id);
    await saveCandidateReview({ candidateId: candidate.id, expectedRevision: 0, decision: "APPROVED", title,
      canonicalQuestion: question, answer, category: "SHIPPING", language, note: "Synthetic browser test approval." }, db);
    const entry = await db.knowledgeEntry.findUniqueOrThrow({ where: { sourceCandidateId: candidate.id } });
    const body = (language === "fr" ? `Bonjour, ${question} Merci pour votre réponse.` : `Hello, ${question} Thank you for your help.`)
      + (failure ? " [synthetic-draft-failure]" : "");
    const thread = await db.emailThread.create({ data: { subject: title, normalizedSubject: marker, language,
      messages: { create: { subject: title, normalizedBody: body, cleanBody: body, htmlBody: '<img src="https://tracking.example.test/pixel"><script>alert("untrusted")</script>',
        direction: "INBOUND", fingerprint: randomUUID(), sourceFileName: "synthetic-browser.eml", participants: { create: { type: "FROM", emailAddress: "reader@example.test", normalizedAddress: "reader@example.test", displayName: "Synthetic reader" } } } },
    } });
    threadIds.push(thread.id);
    if (preGenerate) await runThreadAutomation(thread.id, new MockAIProvider(), db);
    return { threadId: thread.id, candidateId: candidate.id, entryId: entry.id, marker, title, body, answer, question };
  }
  async function reconstruct(input: { parentThreadId: string; childThreadId: string }) {
    if (!threadIds.includes(input.parentThreadId) || !threadIds.includes(input.childThreadId) || input.parentThreadId === input.childThreadId) throw new Error("Only owned synthetic threads may be linked.");
    const parent = await db.emailMessage.findFirstOrThrow({ where: { threadId: input.parentThreadId } });
    const child = await db.emailMessage.findFirstOrThrow({ where: { threadId: input.childThreadId } });
    await db.emailMessage.update({ where: { id: parent.id }, data: { messageId: `<${parent.id}@example.test>`, sentAt: new Date("2026-01-01") } });
    await db.emailMessage.update({ where: { id: child.id }, data: { inReplyTo: `<${parent.id}@example.test>`, sentAt: new Date("2026-01-02") } });
    const plan = await prepareThreadReconstruction(db); receipts.push(plan.id);
    return applyThreadReconstruction(plan, db);
  }
  async function cleanup() {
    await db.auditEvent.deleteMany({ where: { id: { in: receipts }, entityType: "ThreadReconstruction" } });
    const executions = await db.aIExecution.findMany({ where: { OR: [{ classification: { threadId: { in: threadIds } } }, { draft: { threadId: { in: threadIds } } }] }, select: { id: true } });
    // Failed draft executions have no relation; scope them using the fixture classification IDs.
    const classifications = await db.classification.findMany({ where: { threadId: { in: threadIds } }, select: { id: true } });
    for (const classification of classifications) await db.aIExecution.deleteMany({ where: { status: "FAILED", inputMetadata: { path: ["classificationId"], equals: classification.id } } });
    await db.draftKnowledgeSource.deleteMany({ where: { draft: { threadId: { in: threadIds } } } });
    await db.draft.deleteMany({ where: { threadId: { in: threadIds } } });
    await db.classification.deleteMany({ where: { threadId: { in: threadIds } } });
    await db.aIExecution.deleteMany({ where: { id: { in: executions.map((item) => item.id) } } });
    await db.knowledgeCandidateSource.deleteMany({ where: { candidateId: { in: candidateIds } } });
    await db.emailMessage.deleteMany({ where: { threadId: { in: threadIds } } });
    await db.emailThread.updateMany({ where: { id: { in: threadIds } }, data: { mergedIntoThreadId: null } });
    await db.emailThread.deleteMany({ where: { id: { in: threadIds } } });
    const entries = await db.knowledgeEntry.findMany({ where: { sourceCandidateId: { in: candidateIds } }, select: { id: true } });
    await db.auditEvent.deleteMany({ where: { entityType: "KnowledgeEntry", entityId: { in: entries.map((entry) => entry.id) } } });
    await db.knowledgeEntry.deleteMany({ where: { sourceCandidateId: { in: candidateIds } } });
    await db.knowledgeCandidate.deleteMany({ where: { id: { in: candidateIds } } });
    await db.$disconnect();
  }
  return { db, create, cleanup, reconstruct };
}
