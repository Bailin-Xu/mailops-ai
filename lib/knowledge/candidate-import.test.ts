import { describe, expect, it } from "vitest";

import { detectCandidateLanguage } from "@/lib/knowledge/candidate-import";
import { websiteFaqCatalog } from "@/lib/knowledge/website-faq-catalog";
import { websiteReviewSeedItems } from "@/lib/knowledge/website-review-seed-data";

describe("knowledge candidate import rules", () => {
  it("detects French and English without an AI request", () => {
    expect(detectCandidateLanguage("Bonjour, vous pouvez visiter la galerie avec vos enfants.")).toBe("fr");
    expect(detectCandidateLanguage("Hello, you can visit the gallery with your children.")).toBe("en");
  });

  it("keeps the curated website catalog unique and outside blocked conflict keys", () => {
    const catalogKeys = websiteFaqCatalog.map((item) => item.key);
    const blockedKeys = new Set(websiteReviewSeedItems.map((item) => item.key));
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
    expect(catalogKeys.some((key) => blockedKeys.has(key))).toBe(false);
    expect(websiteFaqCatalog.every((item) => item.language === "fr")).toBe(true);
  });
});
