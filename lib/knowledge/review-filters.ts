import { z } from "zod";

import {
  knowledgeExclusionReasonValues,
  knowledgeSourceStatusValues,
} from "@/lib/knowledge/historical-source-assessment";
import { knowledgeReviewStatusValues } from "@/lib/knowledge/review-source";

const firstValue = (value: unknown) =>
  Array.isArray(value) ? value[0] : value;

const reviewFiltersSchema = z.object({
  status: z.preprocess(
    firstValue,
    z.enum(["ALL", ...knowledgeSourceStatusValues]).catch("READY_FOR_REVIEW"),
  ),
  direction: z.preprocess(
    firstValue,
    z.enum(["ALL", "INBOUND", "OUTBOUND", "SELF", "UNKNOWN"]).catch("ALL"),
  ),
  reason: z.preprocess(
    firstValue,
    z.enum(["ALL", ...knowledgeExclusionReasonValues]).catch("ALL"),
  ),
  reviewStatus: z.preprocess(
    firstValue,
    z.enum(["ALL", ...knowledgeReviewStatusValues]).catch("ALL"),
  ),
  q: z.preprocess(firstValue, z.string().trim().max(100).catch("")),
  page: z.preprocess(firstValue, z.coerce.number().int().positive().catch(1)),
  selected: z.preprocess(firstValue, z.string().uuid().optional().catch(undefined)),
});

export type ReviewFilters = z.infer<typeof reviewFiltersSchema>;

export function parseReviewFilters(
  source: Record<string, string | string[] | undefined>,
): ReviewFilters {
  return reviewFiltersSchema.parse(source);
}

export function reviewHref(
  filters: ReviewFilters,
  changes: Partial<ReviewFilters>,
) {
  const next = { ...filters, ...changes };
  const parameters = new URLSearchParams();

  if (next.status !== "READY_FOR_REVIEW") parameters.set("status", next.status);
  if (next.direction !== "ALL") parameters.set("direction", next.direction);
  if (next.reason !== "ALL") parameters.set("reason", next.reason);
  if (next.reviewStatus !== "ALL") {
    parameters.set("reviewStatus", next.reviewStatus);
  }
  if (next.q) parameters.set("q", next.q);
  if (next.page > 1) parameters.set("page", String(next.page));
  if (next.selected) parameters.set("selected", next.selected);

  const query = parameters.toString();
  return query ? `/knowledge-sources?${query}` : "/knowledge-sources";
}
