import { describe, expect, it } from "vitest";

import {
  buildKnowledgeQuery,
  selectGroundingMatch,
} from "@/lib/processing/service";

describe("buildKnowledgeQuery", () => {
  it("builds a compact any-term query instead of requiring the whole email to match", () => {
    expect(
      buildKnowledgeQuery(
        "Question about gallery shipping",
        "Hello, could you please explain your framing policy? Merci.",
      ),
    ).toBe("framing OR policy");
  });

  it("prefers the question body and removes greeting, signature, and generic art terms", () => {
    expect(
      buildKnowledgeQuery(
        "Inscription Galerie Original",
        "Salut Dorian. Est-ce que la plateforme convient à une pratique céramique? Merci, Josie.",
      ),
    ).toBe("plateforme OR convient OR pratique OR céramique");
  });

  it("keeps a wrapped question together when extracting retrieval terms", () => {
    expect(
      buildKnowledgeQuery(
        "Listings",
        "Question: est-ce notre responsabilité d'insérer\nnos listings sur Artsy et qui s'en\noccupe?",
      ),
    ).toBe("responsabilité OR insérer OR listings OR artsy OR occupe");
  });
});

describe("selectGroundingMatch", () => {
  const candidate = (canonicalQuestion: string, answer: string, score: number) => ({
    canonicalQuestion,
    answer,
    score,
  });

  it("rejects a search hit that only matched a broad title", () => {
    expect(selectGroundingMatch("shipping OR eligibility", [
      candidate("What are the opening hours?", "The gallery opens at noon.", 0.9),
    ])).toBeNull();
  });

  it("does not let answer text compensate for a weak canonical-question match", () => {
    expect(selectGroundingMatch("shipping OR eligibility OR policy", [
      candidate(
        "How is shipping arranged?",
        "Eligibility follows the approved policy.",
        0.9,
      ),
    ])).toBeNull();
  });

  it("selects only the strongest answerable source", () => {
    const weak = candidate(
      "How is shipping arranged?",
      "Contact the gallery for details.",
      0.9,
    );
    const strong = candidate(
      "How is shipping eligibility determined?",
      "Shipping eligibility follows the approved policy.",
      0.4,
    );
    expect(selectGroundingMatch("shipping OR eligibility OR policy", [weak, strong])).toBe(strong);
  });
});
