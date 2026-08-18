import Link from "next/link";

import { QuestionCopyButton } from "@/app/website-knowledge/question-copy-button";
import {
  WebsiteReviewForm,
  WebsiteStatusBadge,
} from "@/app/website-knowledge/review-form";
import {
  getWebsiteReviewQueue,
  parseWebsiteReviewFilters,
  websiteReviewHref,
} from "@/lib/knowledge/website-review-queue";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const statusTabs = [
  "PENDING",
  "CONFIRMED",
  "NEEDS_FOLLOW_UP",
  "REJECTED",
  "ALL",
] as const;

export default async function WebsiteKnowledgePage({ searchParams }: PageProps) {
  const filters = parseWebsiteReviewFilters(await searchParams);
  const data = await getWebsiteReviewQueue(filters);
  const reviewed = data.counts.ALL - data.counts.PENDING;

  return (
    <main className="review-shell web-review-shell">
      <header className="review-topbar">
        <Link className="review-brand" href="/">
          <span className="review-brand-mark">M/O</span>
          <span>MailOps AI</span>
        </Link>
        <nav className="review-topbar-nav" aria-label="Knowledge source areas">
          <Link href="/inbox">Inbox</Link>
          <Link href="/knowledge-sources">Email sources</Link>
          <Link href="/knowledge-candidates">Candidates</Link>
          <Link aria-current="page" href="/website-knowledge">
            Website policy
          </Link>
          <Link href="/knowledge-search">Search</Link>
        </nav>
      </header>

      <section className="web-review-intro">
        <div>
          <p className="review-eyebrow">Public website / policy resolution</p>
          <h1>Turn conflicting pages into one answer Dorian can stand behind.</h1>
          <p>
            Compare public claims, copy the exact question to Dorian, then preserve
            his confirmed rule separately from the website evidence.
          </p>
        </div>
        <div className="web-review-progress">
          <span>Resolution progress</span>
          <strong>{reviewed} / {data.counts.ALL}</strong>
          <p>{data.counts.PENDING} questions are still waiting for Dorian.</p>
        </div>
      </section>

      <nav className="web-status-tabs" aria-label="Website review status">
        {statusTabs.map((status) => {
          const active = filters.status === status;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={active ? "is-active" : ""}
              href={websiteReviewHref(filters, {
                status,
                selected: undefined,
              })}
              key={status}
            >
              <span>{tabLabel(status)}</span>
              <strong>{data.counts[status]}</strong>
            </Link>
          );
        })}
      </nav>

      <form className="web-review-search" method="get">
        <input name="status" type="hidden" value={filters.status} />
        <label>
          <span>Search policy questions or evidence</span>
          <input
            defaultValue={filters.q}
            name="q"
            placeholder="Commission, shipping, returns…"
            type="search"
          />
        </label>
        <button type="submit">Search</button>
        <Link href="/website-knowledge">Reset</Link>
      </form>

      <section className="web-review-workbench">
        <aside className="web-review-queue" aria-label="Website policy review queue">
          <div className="web-queue-heading">
            <div>
              <p>Questions for Dorian</p>
              <strong>{data.items.length} item{data.items.length === 1 ? "" : "s"}</strong>
            </div>
            <span>PUBLIC CLAIMS</span>
          </div>

          {data.items.length ? (
            <div className="web-review-list">
              {data.items.map((item) => {
                const selected = data.selected?.id === item.id;
                return (
                  <Link
                    aria-current={selected ? "true" : undefined}
                    className={selected ? "is-selected" : ""}
                    href={websiteReviewHref(filters, { selected: item.id })}
                    key={item.id}
                    scroll={false}
                  >
                    <div>
                      <WebsiteStatusBadge status={item.status} />
                      <span>{item._count.evidence} sources</span>
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.questionForOwner}</p>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="web-review-empty">
              <h2>No policy questions match this view.</h2>
              <p>Choose another status or clear the search.</p>
            </div>
          )}
        </aside>

        {data.selected ? (
          <article className="web-review-detail" aria-label="Selected website policy detail">
            <header className="web-detail-header">
              <WebsiteStatusBadge status={data.selected.status} />
              <p>Selected policy conflict</p>
              <h2>{data.selected.title}</h2>
              <span>{data.selected.evidence.length} public evidence excerpts · French source set</span>
            </header>

            <section className="web-owner-question">
              <div>
                <p>Ask Dorian exactly this</p>
                <QuestionCopyButton question={data.selected.questionForOwner} />
              </div>
              <blockquote lang="fr">{data.selected.questionForOwner}</blockquote>
            </section>

            <section className="web-evidence-section">
              <div className="web-section-heading">
                <p>Contradiction ledger</p>
                <span>Website text is evidence, not policy</span>
              </div>
              <div className="web-evidence-grid">
                {data.selected.evidence.map((evidence, index) => (
                  <article key={evidence.id}>
                    <div>
                      <span>Source {String.fromCharCode(65 + index)}</span>
                      <a href={evidence.source.url} rel="noreferrer" target="_blank">
                        Open page ↗
                      </a>
                    </div>
                    <h3>{evidence.sectionHeading || evidence.source.title}</h3>
                    <p lang={evidence.source.language}>{evidence.claim}</p>
                    <small>{evidence.source.title}</small>
                  </article>
                ))}
              </div>
            </section>

            <WebsiteReviewForm
              answer={data.selected.confirmedAnswer}
              itemId={data.selected.id}
              key={data.selected.id}
              note={data.selected.reviewNote}
              reviewedAt={data.selected.reviewedAt?.toLocaleString("en-CA") ?? null}
              status={data.selected.status}
            />

            {data.selected.reviewEvents.length ? (
              <details className="web-review-history">
                <summary>Review history ({data.selected.reviewEvents.length})</summary>
                <ol>
                  {data.selected.reviewEvents.map((event) => (
                    <li key={event.id}>
                      <strong>{tabLabel(event.decision)}</strong>
                      <span>{event.createdAt.toLocaleString("en-CA")}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </article>
        ) : (
          <div className="web-review-empty web-detail-empty">
            <h2>Select a policy question.</h2>
            <p>The public evidence and owner-confirmation form will appear here.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function tabLabel(status: (typeof statusTabs)[number]) {
  const labels = {
    PENDING: "Waiting",
    CONFIRMED: "Confirmed",
    NEEDS_FOLLOW_UP: "Follow-up",
    REJECTED: "Rejected",
    ALL: "All questions",
  };
  return labels[status];
}
