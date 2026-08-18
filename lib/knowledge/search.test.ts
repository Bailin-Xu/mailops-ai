import { describe, expect, it } from "vitest";

import { parseKnowledgeSearchFilters } from "@/lib/knowledge/search";

describe("knowledge search filters", () => {
  it("normalizes external search parameters", () => {
    expect(
      parseKnowledgeSearchFilters({
        q: "  abonnement Artsy  ",
        language: "fr",
        category: "  SUBSCRIPTION  ",
      }),
    ).toEqual({
      q: "abonnement Artsy",
      language: "fr",
      category: "SUBSCRIPTION",
    });
  });

  it("falls back to all languages for unsupported values", () => {
    expect(parseKnowledgeSearchFilters({ language: "de" }).language).toBe("ALL");
  });
});
