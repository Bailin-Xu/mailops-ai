import { describe, expect, it } from "vitest";

import { assessHistoricalKnowledgeSource } from "@/lib/knowledge/historical-source-assessment";

describe("assessHistoricalKnowledgeSource", () => {
  it("marks a substantive outbound answer and context ready for review", () => {
    expect(
      assessHistoricalKnowledgeSource({
        direction: "OUTBOUND",
        subject: "Re: Registration requirements",
        cleanBody:
          "You can complete the registration without Instagram by adding your professional website.",
        quotedContext:
          "I no longer have an Instagram account. Can I still complete my registration?",
      }),
    ).toEqual({ status: "READY_FOR_REVIEW", exclusionReasons: [] });
  });

  it("always excludes mail that is not outbound", () => {
    const result = assessHistoricalKnowledgeSource({
      direction: "INBOUND",
      subject: "Registration question",
      cleanBody: "A sufficiently long customer message that is not an approved answer source.",
      quotedContext: "A sufficiently long quoted context that should not make it eligible.",
    });

    expect(result.status).toBe("EXCLUDED");
    expect(result.exclusionReasons).toContain("DIRECTION_NOT_OUTBOUND");
  });

  it("records every applicable deterministic exclusion reason", () => {
    expect(
      assessHistoricalKnowledgeSource({
        direction: "OUTBOUND",
        subject: "Fwd: Newsletter",
        cleanBody: "https://example.test/item",
        quotedContext: "Sent with Gmail Mobile",
      }),
    ).toEqual({
      status: "EXCLUDED",
      exclusionReasons: [
        "ANSWER_TOO_SHORT",
        "LINK_ONLY_ANSWER",
        "CONTEXT_TOO_SHORT",
        "NON_SUBSTANTIVE_CONTEXT",
        "FORWARDED_MESSAGE",
      ],
    });
  });

  it("distinguishes missing content from short content", () => {
    const result = assessHistoricalKnowledgeSource({
        direction: "OUTBOUND",
        subject: "Re: Empty",
        cleanBody: "",
        quotedContext: null,
      });

    expect(result.status).toBe("EXCLUDED");
    expect(result.exclusionReasons).toEqual([
      "MISSING_ANSWER",
      "MISSING_CONTEXT",
    ]);
  });

  it("holds substantive mail without context for manual source review", () => {
    expect(
      assessHistoricalKnowledgeSource({
        direction: "OUTBOUND",
        subject: "How to publish on the site",
        cleanBody:
          "Sign in to your account, complete the subscription step, and then finish the profile form.",
        quotedContext: null,
      }),
    ).toEqual({
      status: "NEEDS_REVIEW",
      exclusionReasons: ["MISSING_CONTEXT"],
    });
  });

  it("holds scheduling and one-off private operations for manual review", () => {
    expect(
      assessHistoricalKnowledgeSource({
        direction: "OUTBOUND",
        subject: "Re: Meeting",
        cleanBody: "I am available next week. Please call me when you are free to meet.",
        quotedContext: "Can we reschedule our appointment for sometime next week?",
      }),
    ).toEqual({
      status: "NEEDS_REVIEW",
      exclusionReasons: ["SCHEDULING_OR_MEETING"],
    });

    expect(
      assessHistoricalKnowledgeSource({
        direction: "OUTBOUND",
        subject: "Re: Account request",
        cleanBody:
          "I deleted your account and removed the submitted information as requested.",
        quotedContext:
          "Please delete my account because the registration was submitted without permission.",
      }).status,
    ).toBe("NEEDS_REVIEW");
  });

  it("holds clarification-only replies for manual review", () => {
    expect(
      assessHistoricalKnowledgeSource({
        direction: "OUTBOUND",
        subject: "Re: Form",
        cleanBody: "Bonjour, de quel formulaire parles-tu exactement ?",
        quotedContext:
          "I cannot complete the form because one of the required fields is unavailable.",
      }),
    ).toEqual({
      status: "NEEDS_REVIEW",
      exclusionReasons: ["CLARIFICATION_REQUEST"],
    });
  });
});
