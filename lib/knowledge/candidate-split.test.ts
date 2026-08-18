import { describe, expect, it } from "vitest";

import {
  parseCandidateSplit,
  suggestCandidateSegments,
} from "@/lib/knowledge/candidate-split";

describe("candidate splitting", () => {
  it("suggests atomic candidates from numbered question-and-answer blocks", () => {
    const segments = suggestCandidateSegments(
      "1. Question Artsy ?\n2. Lien public ?\n3. Notification ?",
      [
        "1. Y a-t-il un délai sur Artsy ?\n\nOui, l’export est manuel.",
        "2. Peut-on partager la page ?\n\nOui, elle est publique.",
        "3. Comment sommes-nous notifiés ?\n\nPar courriel.",
      ].join("\n\n"),
    );

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      canonicalQuestion: "Y a-t-il un délai sur Artsy ?",
      proposedAnswer: "Oui, l’export est manuel.",
    });
    expect(segments[2]?.proposedAnswer).toBe("Par courriel.");
  });

  it("allows an unanswered child to remain pending but requires two children", () => {
    const valid = {
      candidateId: "45d980af-0099-4c35-b77f-3c61b8e8a300",
      segments: [
        { title: "Artsy delay", canonicalQuestion: "Y a-t-il un délai sur Artsy ?", proposedAnswer: "Oui." },
        { title: "Photo approval", canonicalQuestion: "Les photos doivent-elles être approuvées ?", proposedAnswer: "" },
      ],
    };
    expect(parseCandidateSplit(valid).segments).toHaveLength(2);
    expect(() => parseCandidateSplit({ ...valid, segments: valid.segments.slice(0, 1) })).toThrow();
  });

  it("separates multiple explicit questions inside one numbered block", () => {
    const segments = suggestCandidateSegments(
      "1. Artsy et photos ? 2. Lien ? 3. Notification ?",
      [
        "1. Je me demandais s'il y a un décalage sur Artsy. Les photos doivent-elles être approuvées? Oui, on exporte manuellement.",
        "2. Peut-on partager la page? Oui, elle est publique.",
        "3. Où sommes-nous notifiés? Par courriel.",
      ].join("\n"),
    );

    expect(segments).toHaveLength(4);
    expect(segments[0]?.proposedAnswer).toBe("Oui, on exporte manuellement.");
    expect(segments[1]).toMatchObject({
      canonicalQuestion: "Les photos doivent-elles être approuvées?",
      proposedAnswer: "",
    });
  });
});
