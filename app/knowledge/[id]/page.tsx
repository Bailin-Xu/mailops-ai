import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getKnowledgeHistory, getComparisonRevision, getAffectedDrafts } from "@/lib/knowledge/history";
import { parsePage } from "@/lib/ui/pagination";
import { CandidateReviewForm } from "@/app/knowledge-candidates/candidate-review-form";
import { Pagination } from "@/app/components/pagination";
import { RetireForm } from "./retire-form";

export default async function KnowledgeReviewPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const entry = await getKnowledgeHistory(id, undefined, parsePage(query.page));
  if (!entry) notFound();
  const rawCompare = Array.isArray(query.compare) ? query.compare[0] : query.compare;
  const compare = rawCompare ? await getComparisonRevision(id, rawCompare) : entry.revisions.find((r) => r.id !== entry.currentRevisionId) ?? null;
  const rawCursor = Array.isArray(query.impact) ? query.impact[0] : query.impact;
  const impact = await getAffectedDrafts({ knowledgeEntryId: id, limit: 10, cursor: z.string().uuid().safeParse(rawCursor).success ? rawCursor : undefined });
  const href = (updates: Record<string, string | undefined>) => {
    const result = new URLSearchParams();
    for (const key of ["page", "compare", "impact"]) { const value = updates[key] ?? (Array.isArray(query[key]) ? query[key][0] : query[key]); if (value) result.set(key, value); }
    return `/knowledge/${id}?${result}`;
  };
  const fields = ["title", "canonicalQuestion", "answer", "category", "language"] as const;
  const labels = { title: "Title", canonicalQuestion: "Canonical question", answer: "Approved answer", category: "Category", language: "Language" };
  return <main className="review-shell version-shell">
    <header className="review-topbar"><Link className="review-brand" href="/">MailOps AI</Link><nav className="review-topbar-nav" aria-label="Knowledge navigation"><Link href="/inbox">Inbox</Link><Link href={`/knowledge-candidates?status=ALL&selected=${entry.sourceCandidateId}`}>Candidate &amp; original sources</Link><Link href="/knowledge-search">Search knowledge</Link></nav></header>
    <section className="version-intro"><p>Human-approved knowledge / immutable history</p><h1>{entry.title}</h1><p>Current version {entry.revisionSequence} · {entry.status}. AI suggestions and original evidence remain in the candidate source trail.</p></section>
    <section className="version-history" aria-labelledby="history-title"><h2 id="history-title">Version history</h2><ul>{entry.revisions.map((revision) => <li key={revision.id}><Link href={href({ compare: revision.id })}>Compare version {revision.version}</Link> · {revision.origin} · {revision.approvedAt.toLocaleString("en-CA")}<p>{revision.reviewEvent?.note ?? "Captured baseline; no approval note."}</p></li>)}</ul>
      <Pagination {...entry.pagination} href={(page) => href({ page: String(page) })} /></section>
    <section className="review-comparison" aria-labelledby="comparison-title"><h2 id="comparison-title">Knowledge version comparison</h2>
      {!compare ? <p>{rawCompare ? "Comparison version is unavailable for this entry." : "No earlier version to compare yet."}</p> : <div className="review-diff-grid"><div><h3>Saved version {compare.version}</h3>{fields.map((field) => <p key={field} className={compare[field] !== entry[field] ? "is-changed" : ""}><b>{labels[field]}</b><span lang={compare.language}>{compare[field]}</span></p>)}</div><div><h3>Current approved version {entry.revisionSequence}</h3>{fields.map((field) => <p key={field} className={compare[field] !== entry[field] ? "is-changed" : ""}><b>{labels[field]}{compare[field] !== entry[field] ? " — changed" : ""}</b><span lang={entry.language}>{entry[field]}</span></p>)}</div></div>}
    </section>
    <section className="version-impact" aria-labelledby="impact-title"><h2 id="impact-title">Affected pending drafts</h2><p>Changed evidence blocks confirmation. Regenerate, review the replacement and confirm a simulated send. Confirmed history is unchanged.</p>
      {impact.items.length ? <ul>{impact.items.map((draft) => <li key={draft.id}><Link href={`/inbox?selected=${draft.threadId}`}>{draft.subject}</Link> · {draft.knowledgeReviewReason?.replaceAll("_", " ").toLowerCase()}<p>Captured version: {draft.knowledgeSources.find((s) => s.knowledgeEntryId === id)?.knowledgeRevision?.version ?? "Legacy / unverified"}</p></li>)}</ul> : <p>No affected pending drafts on this page.</p>}
      {rawCursor && <Link href={`/knowledge/${id}`}>First affected-draft page</Link>} {impact.nextCursor && <Link href={href({ impact: impact.nextCursor })}>More affected drafts</Link>}
    </section>
    <CandidateReviewForm candidate={entry.sourceCandidate} key={entry.sourceCandidateId} />
    {entry.status === "ACTIVE" && entry.currentRevisionId && <RetireForm entryId={id} revisionId={entry.currentRevisionId} />}
  </main>;
}
