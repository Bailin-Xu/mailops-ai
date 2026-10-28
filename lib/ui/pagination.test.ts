import { expect, it } from "vitest";
import { parsePage, pagination } from "./pagination";
import { parseCandidateFilters, candidateHref } from "@/lib/knowledge/candidate-queue";
import { parseInboxFilters, inboxHref } from "@/lib/inbox/queue";

it("validates page state, clamps deleted/out-of-range pages and preserves selection in page links", () => {
  for (const raw of ["-1", "1.5", "Infinity", "bad", undefined]) expect(parsePage(raw)).toBe(1);
  expect(pagination(0, 40)).toMatchObject({ page: 1, pages: 1, skip: 0 });
  expect(pagination(11, 40)).toMatchObject({ page: 2, pages: 2, skip: 10, take: 10 });
  const selected = "00000000-0000-4000-8000-000000000001";
  const filters = parseCandidateFilters({ status: "ALL", source: "EMAIL", q: "réponse", page: "2", selected });
  expect(candidateHref(filters, { page: 3 })).toContain("page=3");
  expect(candidateHref(filters, { page: 3 })).toContain(`selected=${selected}`);
  expect(candidateHref(filters, { status: "PENDING_REVIEW" })).not.toContain("page=");
  expect(parseCandidateFilters({ selected: "------------------------------------" }).selected).toBeUndefined();
  const inbox = parseInboxFilters({ status: "NEEDS_ACTION", q: "livraison", page: "2", selected });
  expect(inboxHref(inbox, { page: 3 })).toContain("q=livraison");
  expect(inboxHref(inbox, { status: "ALL" })).not.toContain("page=");
});
