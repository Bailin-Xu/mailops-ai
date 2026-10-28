import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { buildKnowledgeSearchQuery, type KnowledgeSearchResult, type KnowledgeSearchLanguage } from "@/lib/knowledge/search";
import { selectGroundingMatch } from "@/lib/processing/service";
import type { Config, Knowledge } from "./schemas";

export type Retriever = (input: { q: string; language: KnowledgeSearchLanguage; category: string; limit: number }, knowledge: Knowledge[]) => Promise<KnowledgeSearchResult[]>;

/** Read-only VALUES relation: never reads application knowledge or creates fixture tables. */
export function snapshotRetriever(db: Pick<PrismaClient, "$queryRaw">): Retriever {
  return async (input, knowledge) => {
    const rows = knowledge.map((item) => Prisma.sql`(${item.id}::uuid, ${item.id}::uuid,
      ${item.title}::text, ${item.canonicalQuestion}::text, ${item.answer}::text,
      ${item.category}::text, ${item.language}::text, ${item.status}::text, ${new Date(item.approvedAt)}::timestamp)`);
    const source = Prisma.sql`(VALUES ${Prisma.join(rows)}) AS snapshot("id", "sourceCandidateId", "title", "canonicalQuestion", "answer", "category", "language", "status", "approvedAt")`;
    return db.$queryRaw<KnowledgeSearchResult[]>(buildKnowledgeSearchQuery(input, source));
  };
}

export function selectEvaluationGrounding(query: string, matches: KnowledgeSearchResult[], config: Config) {
  const selected = selectGroundingMatch(query, matches);
  if (!selected || config.retrieval === "baseline-v1") return selected;
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replaceAll(/\s+/gu, " ").trim();
  // One bounded experimental change: abstain on conflicting answers to an identical question.
  return matches.some((item) => normalize(item.canonicalQuestion) === normalize(selected.canonicalQuestion)
    && normalize(item.answer) !== normalize(selected.answer)) ? null : selected;
}
