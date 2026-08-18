import Link from "next/link";

import { CandidateReviewForm } from "@/app/knowledge-candidates/candidate-review-form";
import { CandidateSplitForm } from "@/app/knowledge-candidates/candidate-split-form";
import { BulkApprovalForm } from "@/app/knowledge-candidates/bulk-approval-form";
import { candidateHref, getCandidateQueue, parseCandidateFilters } from "@/lib/knowledge/candidate-queue";
import { candidateStatusLabel } from "@/lib/knowledge/candidate-review";
import { suggestCandidateSegments } from "@/lib/knowledge/candidate-split";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const statusTabs = ["PENDING_REVIEW", "APPROVED", "REJECTED", "ALL"] as const;

export default async function KnowledgeCandidatesPage({ searchParams }: PageProps) {
  const filters = parseCandidateFilters(await searchParams);
  const data = await getCandidateQueue(filters);
  return (
    <main className="review-shell candidate-shell">
      <header className="review-topbar">
        <Link className="review-brand" href="/"><span className="review-brand-mark">M/O</span><span>MailOps AI</span></Link>
        <nav className="review-topbar-nav" aria-label="Knowledge source areas">
          <Link href="/inbox">Inbox</Link>
          <Link href="/knowledge-sources">Email sources</Link>
          <Link aria-current="page" href="/knowledge-candidates">Candidates</Link>
          <Link href="/website-knowledge">Website policy</Link>
          <Link href="/knowledge-search">Search</Link>
        </nav>
      </header>

      <section className="candidate-intro">
        <div>
          <p className="review-eyebrow">Candidate review / knowledge promotion</p>
          <h1>Shape evidence into answers the model may trust.</h1>
          <p>Email replies and stable website FAQs meet here. Edit each proposed answer, then deliberately promote it into active knowledge.</p>
        </div>
        <div className="candidate-pipeline" aria-label="Knowledge promotion pipeline">
          <span>Reviewed source</span><b>→</b><span className="is-current">Candidate</span><b>→</b><span>Active knowledge</span>
          <strong>{data.activeEntries} active</strong>
        </div>
      </section>

      <nav className="candidate-status-tabs" aria-label="Candidate status">
        {statusTabs.map((status) => (
          <Link aria-current={filters.status === status ? "page" : undefined} className={filters.status === status ? "is-active" : ""} href={candidateHref(filters, { status, selected: undefined })} key={status}>
            <span>{status === "ALL" ? "All candidates" : candidateStatusLabel(status)}</span><strong>{data.counts[status]}</strong>
          </Link>
        ))}
      </nav>

      <form className="candidate-filters" method="get">
        <input name="status" type="hidden" value={filters.status} />
        <label><span>Search candidates</span><input defaultValue={filters.q} name="q" placeholder="Question, answer, or title…" type="search" /></label>
        <label><span>Source</span><select defaultValue={filters.source} name="source"><option value="ALL">All sources</option><option value="EMAIL">Email ({data.sourceCounts.EMAIL})</option><option value="WEBSITE">Website ({data.sourceCounts.WEBSITE})</option></select></label>
        <button type="submit">Apply filters</button><Link href="/knowledge-candidates">Reset</Link>
      </form>

      <BulkApprovalForm
        eligibleCount={data.bulkEligible}
        q={filters.q}
        source={filters.source}
      />

      <section className="candidate-workbench">
        <aside className="candidate-queue" aria-label="Knowledge candidate queue">
          <div className="candidate-queue-heading"><div><p>Candidate queue</p><strong>{data.items.length} results</strong></div><span>{filters.source === "ALL" ? "ALL SOURCES" : filters.source}</span></div>
          {data.items.length ? (
            <div className="candidate-list">
              {data.items.map((item) => {
                const selected = data.selected?.id === item.id;
                const sourceTypes = [...new Set(item.sources.map((source) => source.sourceType))];
                return (
                  <Link aria-current={selected ? "true" : undefined} className={selected ? "is-selected" : ""} href={candidateHref(filters, { selected: item.id })} key={item.id} scroll={false}>
                    <div className="candidate-list-meta"><span className={`candidate-status status-${item.status.toLowerCase()}`}>{candidateStatusLabel(item.status)}</span><span>{sourceTypes.join(" + ")}</span><span>{item.language.toUpperCase()}</span></div>
                    <h2>{item.title}</h2><p>{item.canonicalQuestion}</p><small>{item.category.replaceAll("_", " ")}</small>
                  </Link>
                );
              })}
            </div>
          ) : <div className="candidate-empty"><h2>No candidates match.</h2><p>Change the status, source, or search filter.</p></div>}
        </aside>

        {data.selected ? (
          <article className="candidate-detail">
            <header className="candidate-detail-heading">
              <div className="candidate-list-meta"><span className={`candidate-status status-${data.selected.status.toLowerCase()}`}>{candidateStatusLabel(data.selected.status)}</span><span>{data.selected.language.toUpperCase()}</span></div>
              <p>Selected candidate</p><h2>{data.selected.title}</h2><span>{data.selected.sources.length} traceable source{data.selected.sources.length === 1 ? "" : "s"}</span>
            </header>
            <section className="candidate-proposal">
              <div><p>Proposed question</p><span>Untrusted until approved</span></div><h3>{data.selected.canonicalQuestion}</h3><p lang={data.selected.language}>{data.selected.proposedAnswer}</p>
            </section>
            <CandidateReviewForm candidate={data.selected} key={data.selected.id} />
            {data.selected.status === "PENDING_REVIEW" ? (
              <CandidateSplitForm
                candidateId={data.selected.id}
                initialSegments={suggestCandidateSegments(
                  data.selected.canonicalQuestion,
                  data.selected.proposedAnswer,
                )}
                key={`split-${data.selected.id}`}
              />
            ) : null}
            <section className="candidate-sources">
              <div><p>Source trail</p><span>Original evidence remains unchanged</span></div>
              {data.selected.sources.map((source) => (
                <article key={source.id}><span>{source.sourceType}</span><h3>{source.sourceLabel}</h3><p>{source.sourceExcerpt}</p>
                  {source.emailMessage ? <Link href={`/knowledge-sources?status=ALL&selected=${source.emailMessage.id}`}>Open reviewed email →</Link> : source.websiteSource ? <a href={source.websiteSource.url} rel="noreferrer" target="_blank">Open public page ↗</a> : null}
                </article>
              ))}
            </section>
            {data.selected.knowledgeEntry ? <div className="candidate-active-record"><span>Knowledge entry</span><strong>{data.selected.knowledgeEntry.status}</strong><p>Approved {data.selected.knowledgeEntry.approvedAt.toLocaleString("en-CA")}</p></div> : null}
          </article>
        ) : <div className="candidate-empty candidate-detail-empty"><h2>Select a candidate.</h2><p>The proposal, editor, and source trail will appear here.</p></div>}
      </section>
    </main>
  );
}
