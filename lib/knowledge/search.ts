import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { z } from "zod";

export const knowledgeSearchLanguageValues = ["ALL", "fr", "en"] as const;
export type KnowledgeSearchLanguage = (typeof knowledgeSearchLanguageValues)[number];

export type KnowledgeSearchFilters = {
  q: string;
  language: KnowledgeSearchLanguage;
  category: string;
};

export type KnowledgeSearchResult = {
  id: string;
  sourceCandidateId: string;
  title: string;
  canonicalQuestion: string;
  answer: string;
  category: string;
  language: string;
  approvedAt: Date;
  textScore: number;
  categoryBonus: number;
  score: number;
};

const searchInputSchema = z.object({
  q: z.string().trim().min(2, "Enter at least two characters.").max(500),
  language: z.enum(knowledgeSearchLanguageValues).default("ALL"),
  category: z.string().trim().max(100).default(""),
  limit: z.number().int().min(1).max(20).default(8),
});

export function parseKnowledgeSearchFilters(
  input: Record<string, string | string[] | undefined>,
): KnowledgeSearchFilters {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const language = first(input.language);

  return {
    q: (first(input.q) ?? "").trim().slice(0, 500),
    language: knowledgeSearchLanguageValues.includes(
      language as KnowledgeSearchLanguage,
    )
      ? (language as KnowledgeSearchLanguage)
      : "ALL",
    category: (first(input.category) ?? "").trim().slice(0, 100),
  };
}

export async function searchActiveKnowledge(
  input: {
    q: string;
    language?: KnowledgeSearchLanguage;
    category?: string;
    limit?: number;
  },
  db: PrismaClient = getDb(),
): Promise<KnowledgeSearchResult[]> {
  const search = searchInputSchema.parse(input);
  const branches = languageBranches(search.language).map(({ configuration, predicate }) => {
    const document = Prisma.sql`
      setweight(to_tsvector(${Prisma.raw(`'${configuration}'`)}, coalesce("title", '')), 'A') ||
      setweight(to_tsvector(${Prisma.raw(`'${configuration}'`)}, coalesce("canonicalQuestion", '')), 'B') ||
      setweight(to_tsvector(${Prisma.raw(`'${configuration}'`)}, coalesce("answer", '')), 'C') ||
      setweight(to_tsvector('simple', coalesce("category", '')), 'B')
    `;
    const query = Prisma.sql`websearch_to_tsquery(${Prisma.raw(`'${configuration}'`)}, ${search.q})`;
    const categoryBonus = search.category
      ? Prisma.sql`CASE WHEN lower("category") = lower(${search.category}) THEN 0.25 ELSE 0 END`
      : Prisma.sql`0.0`;

    return Prisma.sql`
      SELECT
        "id",
        "sourceCandidateId",
        "title",
        "canonicalQuestion",
        "answer",
        "category",
        "language",
        "approvedAt",
        ts_rank_cd(${document}, ${query})::float8 AS "textScore",
        (${categoryBonus})::float8 AS "categoryBonus",
        (ts_rank_cd(${document}, ${query})::float8 + (${categoryBonus})::float8) AS "score"
      FROM "KnowledgeEntry"
      WHERE "status" = 'ACTIVE'
        AND ${predicate}
        AND (${document}) @@ ${query}
    `;
  });

  return db.$queryRaw<KnowledgeSearchResult[]>(Prisma.sql`
    WITH ranked AS (
      ${Prisma.join(branches, " UNION ALL ")}
    )
    SELECT * FROM ranked
    ORDER BY "score" DESC, "approvedAt" DESC
    LIMIT ${search.limit}
  `);
}

export async function getKnowledgeSearchOverview(db: PrismaClient = getDb()) {
  const [activeCount, categoryRows] = await Promise.all([
    db.knowledgeEntry.count({ where: { status: "ACTIVE" } }),
    db.knowledgeEntry.groupBy({
      by: ["category"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
      orderBy: { category: "asc" },
    }),
  ]);

  return {
    activeCount,
    categories: categoryRows.map((row) => ({
      value: row.category,
      count: row._count._all,
    })),
  };
}

function languageBranches(language: KnowledgeSearchLanguage) {
  if (language === "fr") {
    return [{ configuration: "french", predicate: Prisma.sql`"language" = 'fr'` }];
  }
  if (language === "en") {
    return [{ configuration: "english", predicate: Prisma.sql`"language" = 'en'` }];
  }
  return [
    { configuration: "french", predicate: Prisma.sql`"language" = 'fr'` },
    { configuration: "english", predicate: Prisma.sql`"language" = 'en'` },
    {
      configuration: "simple",
      predicate: Prisma.sql`"language" NOT IN ('fr', 'en')`,
    },
  ];
}
