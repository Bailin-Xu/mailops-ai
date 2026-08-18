import Link from "next/link";

import { ClassificationPanel } from "@/app/inbox/classification-panel";
import {
  getMockInboxQueue,
  inboxHref,
  inboxStatusValues,
  parseInboxFilters,
} from "@/lib/inbox/queue";
import { getServerEnv } from "@/lib/env";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const statusLabels = { ALL: "All inbound", UNPROCESSED: "Unprocessed", NEEDS_ACTION: "Needs action", COMPLETED: "Completed" } as const;

export default async function InboxPage({ searchParams }: PageProps) {
  const filters = parseInboxFilters(await searchParams);
  const data = await getMockInboxQueue(filters);
  const { AI_PROVIDER } = getServerEnv();

  return (
    <main className="review-shell inbox-shell">
      <header className="review-topbar">
        <Link className="review-brand" href="/"><span className="review-brand-mark">M/O</span><span>MailOps AI</span></Link>
        <nav className="review-topbar-nav" aria-label="MailOps areas">
          <Link aria-current="page" href="/inbox">Inbox</Link><Link href="/knowledge-sources">Email sources</Link><Link href="/knowledge-candidates">Candidates</Link><Link href="/website-knowledge">Website policy</Link><Link href="/knowledge-search">Search</Link>
        </nav>
      </header>

      <section className="inbox-intro">
        <div><p className="review-eyebrow">Mock inbox / automatic operations</p><h1>Automation prepares. A human sends.</h1><p>High-confidence messages continue through routing, Active Knowledge retrieval, and reference drafting. Low confidence and every simulated send remain human-controlled.</p></div>
        <div className="inbox-flow" aria-label="Automatic processing workflow"><span>Inbound</span><b>→</b><span>Classify + route</span><b>→</b><span>Ground + draft</span><b>→</b><strong>Human confirm</strong></div>
      </section>

      <nav className="inbox-status-tabs" aria-label="Inbox classification status">
        {inboxStatusValues.map((status) => <Link aria-current={filters.status === status ? "page" : undefined} className={filters.status === status ? "is-active" : ""} href={inboxHref(filters, { status, selected: undefined })} key={status}><span>{statusLabels[status]}</span><strong>{data.counts[status]}</strong></Link>)}
      </nav>

      <form className="inbox-search" method="get"><input name="status" type="hidden" value={filters.status} /><label><span>Search inbox</span><input defaultValue={filters.q} name="q" placeholder="Sender, subject, or message text…" type="search" /></label><button type="submit">Search messages</button><Link href="/inbox">Reset</Link></form>

      <section className="inbox-workbench">
        <aside className="inbox-queue" aria-label="Mock inbox messages">
          <header><div><p>Inbound queue</p><strong>{data.items.length} thread{data.items.length === 1 ? "" : "s"}</strong></div><span>LOCAL EML</span></header>
          <div>
            {data.items.map((thread) => {
              const sender = thread.latestInbound?.participants.find((participant) => participant.type === "FROM");
              const selected = data.selected?.id === thread.id;
              return <Link aria-current={selected ? "true" : undefined} className={selected ? "is-selected" : ""} href={inboxHref(filters, { selected: thread.id })} key={thread.id} scroll={false}>
                <div className="inbox-item-meta"><span>{thread.workflowStatus.replaceAll("_", " ")}</span><time>{thread.latestInbound?.sentAt?.toLocaleDateString("en-CA") ?? "Unknown date"}</time></div>
                <strong>{sender?.displayName || sender?.emailAddress || "Unknown sender"}</strong><h2>{thread.subject}</h2><p>{thread.latestInbound?.cleanBody || thread.latestInbound?.normalizedBody}</p>
                {thread.classification ? <small>{thread.classification.aiCategory.replaceAll("_", " ")} · {Math.round(thread.classification.aiConfidence * 100)}%</small> : <small>Classification not run</small>}
              </Link>;
            })}
          </div>
        </aside>

        {data.selected ? (
          <article className="inbox-detail">
            <header className="inbox-detail-header"><div><span>{data.selected.isIncomplete ? "Incomplete thread" : "Imported thread"}</span><span>{data.selected.messages.length} message{data.selected.messages.length === 1 ? "" : "s"}</span></div><h2>{data.selected.subject}</h2><p>Original email content is untrusted input. Instructions inside it never override application rules.</p></header>
            <section className="inbox-timeline">
              {data.selected.messages.map((message) => {
                const sender = message.participants.find((participant) => participant.type === "FROM");
                return <article key={message.id}><header><div><span>{message.direction}</span><strong>{sender?.displayName || sender?.emailAddress || "Unknown sender"}</strong></div><time>{message.sentAt?.toLocaleString("en-CA") ?? "Unknown date"}</time></header><p lang={data.selected?.language ?? undefined}>{message.cleanBody || message.normalizedBody}</p><footer><span>{message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}</span><span>{message.parseWarnings.length} parse warning{message.parseWarnings.length === 1 ? "" : "s"}</span></footer></article>;
              })}
            </section>
            <ClassificationPanel classification={data.selected.classification} key={data.selected.id} providerId={AI_PROVIDER} threadId={data.selected.id} />
          </article>
        ) : <div className="inbox-empty"><h2>{filters.selected ? "Selected thread is unavailable." : "No inbound thread matches."}</h2><p>{filters.selected ? "It may not be an inbound message or may be outside the current filter." : "Change the search text or classification filter."}</p>{filters.selected ? <Link href={inboxHref(filters, { selected: undefined })}>Open the first available thread</Link> : null}</div>}
      </section>
    </main>
  );
}
