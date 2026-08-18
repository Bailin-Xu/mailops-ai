"use client";

export default function KnowledgeSourcesError({ reset }: { reset: () => void }) {
  return (
    <main className="review-shell">
      <section className="review-fatal-error">
        <p>Review queue unavailable</p>
        <h1>The local message index could not be loaded.</h1>
        <span>Check the PostgreSQL container, then retry this view.</span>
        <button onClick={() => reset()} type="button">
          Retry loading
        </button>
      </section>
    </main>
  );
}
