import Link from "next/link";

import {
  getKnowledgeSearchOverview,
  parseKnowledgeSearchFilters,
  searchActiveKnowledge,
} from "@/lib/knowledge/search";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function KnowledgeSearchPage({ searchParams }: PageProps) {
  const filters = parseKnowledgeSearchFilters(await searchParams);
  const overview = await getKnowledgeSearchOverview();
  const hasQuery = filters.q.length >= 2;
  const results = hasQuery
    ? await searchActiveKnowledge({
        q: filters.q,
        language: filters.language,
        category: filters.category,
      })
    : [];

  return (
    <main className="review-shell knowledge-search-shell">
      <header className="review-topbar">
        <Link className="review-brand" href="/"><span className="review-brand-mark">M/O</span><span>MailOps AI</span></Link>
        <nav className="review-topbar-nav" aria-label="Knowledge areas">
          <Link href="/inbox">Inbox</Link>
          <Link href="/knowledge-sources">Email sources</Link>
          <Link href="/knowledge-candidates">Candidates</Link>
          <Link href="/website-knowledge">Website policy</Link>
          <Link aria-current="page" href="/knowledge-search">Search</Link>
        </nav>
      </header>

      <section className="knowledge-search-intro">
        <div>
          <p className="review-eyebrow">Active knowledge / retrieval baseline</p>
          <h1>Ask the knowledge we have actually approved.</h1>
          <p>Test a customer question against trusted answers before the retrieval layer is connected to draft generation.</p>
        </div>
        <aside>
          <span>Trusted retrieval scope</span>
          <strong>{overview.activeCount}</strong>
          <p>ACTIVE entries only. Inactive and archived knowledge never enters these results.</p>
        </aside>
      </section>

      <section className="knowledge-query-panel">
        <form method="get">
          <label className="knowledge-query-main"><span>Customer question</span><input autoFocus defaultValue={filters.q} name="q" placeholder="Ex. La présence sur Artsy est-elle incluse dans l’abonnement ?" type="search" /></label>
          <label><span>Language</span><select defaultValue={filters.language} name="language"><option value="ALL">All languages</option><option value="fr">French</option><option value="en">English</option></select></label>
          <label><span>Prefer category</span><select defaultValue={filters.category} name="category"><option value="">Any category</option>{overview.categories.map((category) => <option key={category.value} value={category.value}>{category.value.replaceAll("_", " ")} ({category.count})</option>)}</select></label>
          <button type="submit">Search active knowledge</button>
        </form>
        <div className="knowledge-weight-rail" aria-label="Search field weights">
          <span><b>A</b> Title</span><span><b>B</b> Customer question</span><span><b>C</b> Approved answer</span><em>PostgreSQL full-text ranking</em>
        </div>
      </section>

      {!hasQuery ? (
        <section className="knowledge-search-empty"><span>01</span><div><h2>Start with a real customer question.</h2><p>Use at least two characters. Search does not call Gemini and does not consume AI tokens.</p></div></section>
      ) : results.length ? (
        <section className="knowledge-results" aria-live="polite">
          <header><div><p>Ranked evidence</p><h2>{results.length} trusted match{results.length === 1 ? "" : "es"}</h2></div><span>Query: “{filters.q}”</span></header>
          <div>
            {results.map((result, index) => (
              <article key={result.id}>
                <div className="knowledge-rank"><span>{String(index + 1).padStart(2, "0")}</span><strong>{result.score.toFixed(3)}</strong><small>relevance</small></div>
                <div className="knowledge-result-copy">
                  <div><span>{result.language.toUpperCase()}</span><span>{result.category.replaceAll("_", " ")}</span>{result.categoryBonus > 0 ? <span>Category preferred</span> : null}</div>
                  <h3>{result.title}</h3>
                  <p className="knowledge-result-question">{result.canonicalQuestion}</p>
                  <p lang={result.language}>{result.answer}</p>
                  <Link href={`/knowledge-candidates?status=APPROVED&selected=${result.sourceCandidateId}`}>Inspect approved source →</Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="knowledge-no-results" role="status"><span>No grounded answer</span><h2>Active knowledge does not support this question yet.</h2><p>Do not generate a known-answer draft. Route the inquiry for human follow-up or create a reviewed candidate later.</p></section>
      )}
    </main>
  );
}
