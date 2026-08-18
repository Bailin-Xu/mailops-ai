import Link from "next/link";

import { ReviewDecisionForm } from "@/app/knowledge-sources/review-decision-form";
import {
  knowledgeExclusionReasonValues,
  type KnowledgeExclusionReason,
  type KnowledgeSourceStatus,
} from "@/lib/knowledge/historical-source-assessment";
import {
  parseReviewFilters,
  reviewHref,
} from "@/lib/knowledge/review-filters";
import {
  directionLabels,
  humanReviewLabels,
  reasonLabels,
  statusLabels,
} from "@/lib/knowledge/review-labels";
import { knowledgeReviewStatusValues } from "@/lib/knowledge/review-source";
import {
  getKnowledgeSourceReviewQueue,
  REVIEW_PAGE_SIZE,
} from "@/lib/knowledge/review-queue";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const statusTabs = [
  "READY_FOR_REVIEW",
  "NEEDS_REVIEW",
  "EXCLUDED",
  "ALL",
] as const;

export default async function KnowledgeSourcesPage({ searchParams }: PageProps) {
  const filters = parseReviewFilters(await searchParams);
  const data = await getKnowledgeSourceReviewQueue(filters);

  return (
    <main className="review-shell">
      <header className="review-topbar">
        <Link className="review-brand" href="/">
          <span className="review-brand-mark">M/O</span>
          <span>MailOps AI</span>
        </Link>
        <div className="review-topbar-tools">
          <nav className="review-topbar-nav" aria-label="Knowledge source areas">
            <Link href="/inbox">Inbox</Link>
            <Link aria-current="page" href="/knowledge-sources">Email sources</Link>
            <Link href="/knowledge-candidates">Candidates</Link>
            <Link href="/website-knowledge">Website policy</Link>
            <Link href="/knowledge-search">Search</Link>
          </nav>
          <div className="review-topbar-context">
            <span className="review-live-dot" aria-hidden="true" />
            Local review workspace
          </div>
        </div>
      </header>

      <section className="review-intro">
        <div>
          <p className="review-eyebrow">Historical knowledge / source review</p>
          <h1>Review the evidence before it becomes knowledge.</h1>
          <p className="review-lede">
            Compare the sender reply with its quoted context. Prescreen labels are
            deterministic signals—not approval decisions.
          </p>
        </div>
        <div className="review-scope-note">
          <span>Human review progress</span>
          <strong>{data.reviewCounts.ALL - data.reviewCounts.PENDING} reviewed</strong>
          <p>{data.reviewCounts.PENDING} sources still need a decision.</p>
        </div>
      </section>

      <nav className="review-status-tabs" aria-label="Prescreen status">
        {statusTabs.map((status) => {
          const active = filters.status === status;
          const label = status === "ALL" ? "All mail" : statusLabels[status];
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`review-status-tab ${active ? "is-active" : ""}`}
              href={reviewHref(filters, {
                status,
                page: 1,
                selected: undefined,
              })}
              key={status}
            >
              <span>{label}</span>
              <strong>{data.counts[status]}</strong>
            </Link>
          );
        })}
      </nav>

      <form className="review-filters" method="get">
        <input name="status" type="hidden" value={filters.status} />
        <label className="review-search-field">
          <span>Search</span>
          <input
            defaultValue={filters.q}
            name="q"
            placeholder="Subject, reply, or quoted context"
            type="search"
          />
        </label>
        <label>
          <span>Direction</span>
          <select defaultValue={filters.direction} name="direction">
            <option value="ALL">All directions</option>
            {Object.entries(directionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Reason</span>
          <select defaultValue={filters.reason} name="reason">
            <option value="ALL">All reasons</option>
            {knowledgeExclusionReasonValues.map((reason) => (
              <option key={reason} value={reason}>
                {reasonLabels[reason]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Human decision</span>
          <select defaultValue={filters.reviewStatus} name="reviewStatus">
            <option value="ALL">All decisions</option>
            {knowledgeReviewStatusValues.map((status) => (
              <option key={status} value={status}>
                {humanReviewLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Apply filters</button>
        <Link href={reviewHref(parseReviewFilters({}), {})}>Reset</Link>
      </form>

      <section className="review-workbench">
        <div className="review-queue" aria-label="Knowledge source queue">
          <div className="review-panel-heading">
            <div>
              <p>Review queue</p>
              <strong>
                {data.total} result{data.total === 1 ? "" : "s"}
              </strong>
            </div>
            <span>
              {data.total === 0
                ? "No rows"
                : `${(filters.page - 1) * REVIEW_PAGE_SIZE + 1}–${Math.min(
                    filters.page * REVIEW_PAGE_SIZE,
                    data.total,
                  )}`}
            </span>
          </div>

          {data.messages.length === 0 ? (
            <div className="review-empty">
              <span>0</span>
              <h2>No messages match this view.</h2>
              <p>Clear a filter or choose another prescreen status.</p>
            </div>
          ) : (
            <div className="review-message-list">
              {data.messages.map((message) => {
                const selected = data.selected?.id === message.id;
                const sender = message.participants[0];
                return (
                  <Link
                    aria-current={selected ? "true" : undefined}
                    className={`review-message-row status-${message.knowledgeSourceStatus.toLowerCase()} ${selected ? "is-selected" : ""}`}
                    href={reviewHref(filters, { selected: message.id })}
                    key={message.id}
                    scroll={false}
                  >
                    <div className="review-message-meta">
                      <span>{sender?.displayName || sender?.emailAddress || "Unknown sender"}</span>
                      <time>{formatDate(message.sentAt)}</time>
                    </div>
                    <h2>{message.subject || "(no subject)"}</h2>
                    <p>{preview(message.cleanBody || message.quotedContext || "No readable body")}</p>
                    <div className="review-message-tags">
                      <StatusBadge status={message.knowledgeSourceStatus} />
                      <span className="review-direction-badge">
                        {directionLabels[message.direction]}
                      </span>
                      <HumanReviewBadge status={message.knowledgeReviewStatus} />
                      {message.knowledgeExclusionReasons.slice(0, 1).map((reason) => (
                        <ReasonBadge key={reason} reason={reason as KnowledgeExclusionReason} />
                      ))}
                      {message.knowledgeExclusionReasons.length > 1 ? (
                        <span className="review-more-reasons">
                          +{message.knowledgeExclusionReasons.length - 1}
                        </span>
                      ) : null}
                    </div>
                    <div className="review-char-counts">
                      <span>Reply {message.cleanBody.length}</span>
                      <span>Context {message.quotedContext?.length ?? 0}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="review-pagination">
            {filters.page > 1 ? (
              <Link href={reviewHref(filters, { page: filters.page - 1, selected: undefined })}>
                ← Previous
              </Link>
            ) : (
              <span>← Previous</span>
            )}
            <strong>
              Page {Math.min(filters.page, data.totalPages)} of {data.totalPages}
            </strong>
            {filters.page < data.totalPages ? (
              <Link href={reviewHref(filters, { page: filters.page + 1, selected: undefined })}>
                Next →
              </Link>
            ) : (
              <span>Next →</span>
            )}
          </div>
        </div>

        <article className="review-detail" aria-label="Selected email detail">
          {data.selected ? (
            <>
              <div className="review-detail-header">
                <div className="review-detail-badges">
                  <StatusBadge status={data.selected.knowledgeSourceStatus} />
                  <span className="review-direction-badge">
                    {directionLabels[data.selected.direction]}
                  </span>
                  <HumanReviewBadge status={data.selected.knowledgeReviewStatus} />
                </div>
                <p className="review-detail-kicker">Selected evidence</p>
                <h2>{data.selected.subject || "(no subject)"}</h2>
                <div className="review-detail-meta">
                  <span>{formatDate(data.selected.sentAt, true)}</span>
                  <span>Imported EML source</span>
                  <span>{data.selected.attachments.length} attachments</span>
                </div>
              </div>

              {data.selected.knowledgeExclusionReasons.length > 0 ? (
                <section className="review-reason-strip">
                  <p>Why it was held back</p>
                  <div>
                    {data.selected.knowledgeExclusionReasons.map((reason) => (
                      <ReasonBadge key={reason} reason={reason as KnowledgeExclusionReason} />
                    ))}
                  </div>
                </section>
              ) : (
                <section className="review-ready-note">
                  <span>Structure passed</span>
                  <p>This source still requires human review before a candidate is created.</p>
                </section>
              )}

              <ReviewDecisionForm
                key={data.selected.id}
                canApprove={
                  data.selected.direction === "OUTBOUND" &&
                  data.selected.cleanBody.trim().length > 0
                }
                messageId={data.selected.id}
                note={data.selected.knowledgeReviewNote}
                reviewedAt={
                  data.selected.knowledgeReviewedAt
                    ? formatDate(data.selected.knowledgeReviewedAt, true)
                    : null
                }
                status={data.selected.knowledgeReviewStatus}
              />

              <MessageSection
                body={data.selected.cleanBody}
                eyebrow="Derived answer"
                empty="No substantive reply remained after cleaning."
                title="Sender reply"
              />
              <MessageSection
                body={data.selected.quotedContext ?? ""}
                eyebrow="Untrusted inline quote"
                empty="No reliable quoted context was extracted."
                title="Customer context"
                tone="context"
              />

              <details className="review-source-details">
                <summary>Inspect normalized source</summary>
                <p>
                  Preserved normalized text for debugging extraction. It is not used as the
                  reviewer-facing answer.
                </p>
                <pre>{data.selected.normalizedBody || "No normalized body."}</pre>
              </details>

              <footer className="review-detail-footer">
                <div>
                  <span>Participants</span>
                  <p>{data.selected.participants.length}</p>
                </div>
                <div>
                  <span>Parse warnings</span>
                  <p>{data.selected.parseWarnings.length}</p>
                </div>
                <div>
                  <span>Workflow</span>
                  <p>Human review</p>
                </div>
              </footer>
            </>
          ) : (
            <div className="review-empty review-empty-detail">
              <span>↗</span>
              <h2>Select a message to inspect.</h2>
              <p>The cleaned reply and quoted customer context will appear here.</p>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: KnowledgeSourceStatus }) {
  return (
    <span className={`review-status-badge status-${status.toLowerCase()}`}>
      {statusLabels[status]}
    </span>
  );
}

function ReasonBadge({ reason }: { reason: KnowledgeExclusionReason }) {
  return <span className="review-reason-badge">{reasonLabels[reason]}</span>;
}

function HumanReviewBadge({
  status,
}: {
  status: keyof typeof humanReviewLabels;
}) {
  return (
    <span className={`human-review-state state-${status.toLowerCase()}`}>
      {humanReviewLabels[status]}
    </span>
  );
}

function MessageSection({
  body,
  eyebrow,
  empty,
  title,
  tone = "reply",
}: {
  body: string;
  eyebrow: string;
  empty: string;
  title: string;
  tone?: "reply" | "context";
}) {
  return (
    <section className={`review-message-section tone-${tone}`}>
      <div>
        <p>{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      {body ? <pre>{body}</pre> : <p className="review-body-empty">{empty}</p>}
    </section>
  );
}

function preview(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 125 ? `${compact.slice(0, 125)}…` : compact;
}

function formatDate(value: Date | null, includeTime = false) {
  if (!value) return "Unknown date";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" } : {}),
  }).format(value);
}
