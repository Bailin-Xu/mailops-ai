import Link from "next/link";
export function Pagination({ page, pages, total, href }: { page: number; pages: number; total: number; href: (page: number) => string }) {
  return <nav className="review-pagination" aria-label="Pagination">
    {page > 1 ? <Link href={href(page - 1)}>Previous page</Link> : <span>Previous page</span>}
    <span>Page {page} of {pages} · {total} results</span>
    {page < pages ? <Link href={href(page + 1)}>Next page</Link> : <span>Next page</span>}
  </nav>;
}
