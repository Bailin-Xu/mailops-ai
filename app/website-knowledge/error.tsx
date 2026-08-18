"use client";

export default function WebsiteKnowledgeError({ reset }: { reset: () => void }) {
  return (
    <main className="review-shell">
      <section className="review-fatal-error">
        <p>Website policy review unavailable</p>
        <h1>The local policy queue could not be loaded.</h1>
        <span>Check PostgreSQL, then retry this view.</span>
        <button onClick={reset} type="button">Retry loading</button>
      </section>
    </main>
  );
}
