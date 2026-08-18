-- Weighted PostgreSQL full-text indexes for trusted knowledge retrieval.
-- Partial indexes exclude inactive and archived entries from the retrieval path.
CREATE INDEX "KnowledgeEntry_active_search_fr_idx"
ON "KnowledgeEntry"
USING GIN (
  (
    setweight(to_tsvector('french', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('french', coalesce("canonicalQuestion", '')), 'B') ||
    setweight(to_tsvector('french', coalesce("answer", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("category", '')), 'B')
  )
)
WHERE "status" = 'ACTIVE' AND "language" = 'fr';

CREATE INDEX "KnowledgeEntry_active_search_en_idx"
ON "KnowledgeEntry"
USING GIN (
  (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("canonicalQuestion", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("answer", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("category", '')), 'B')
  )
)
WHERE "status" = 'ACTIVE' AND "language" = 'en';

CREATE INDEX "KnowledgeEntry_active_search_other_idx"
ON "KnowledgeEntry"
USING GIN (
  (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("canonicalQuestion", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("answer", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("category", '')), 'B')
  )
)
WHERE "status" = 'ACTIVE' AND "language" NOT IN ('fr', 'en');
