export const REVIEW_PAGE_SIZE = 10;
export function parsePage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
}
export function pagination(total: number, requested = 1, size = REVIEW_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.max(1, Math.min(requested, pages));
  return { page, pages, total, skip: (page - 1) * size, take: size };
}
