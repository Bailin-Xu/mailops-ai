"use client";
import Link from "next/link";
export function ReviewError({ reset }: { reset: () => void }) {
  return <main className="review-shell review-notice" role="alert"><h1>This review could not be loaded.</h1><p>Your saved records are unchanged. Check the local database connection, then retry.</p><button onClick={reset} type="button">Try loading again</button><Link href="/inbox">Return to Inbox</Link></main>;
}
