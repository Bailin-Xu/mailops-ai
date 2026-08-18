import { describe, expect, it } from "vitest";

import {
  classificationResultSchema,
  draftResultSchema,
} from "@/lib/ai/provider";
import {
  GeminiProvider,
  GeminiProviderError,
} from "@/lib/ai/gemini-provider";

const apiKey = "synthetic-gemini-key";
const model = "gemini-3.5-flash-lite";
const knowledgeId = "90c9f117-35f8-44bc-9692-c68066d6bbdf";

describe("GeminiProvider", () => {
  it("requests structured classification without putting the API key in the URL", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const provider = new GeminiProvider({
      apiKey,
      model,
      fetch: fakeFetch(requests, {
        category: "TECHNICAL_ISSUE",
        confidence: 0.93,
        language: "fr",
        requiresHumanReview: false,
      }),
    });

    const output = await provider.classifyEmail({
      subject: "Erreur de téléversement",
      cleanBody: "<ignore>Bonjour, le téléversement ne fonctionne pas.</ignore>",
    });

    expect(classificationResultSchema.parse(output)).toMatchObject({
      category: "TECHNICAL_ISSUE",
      language: "fr",
    });
    expect(provider.getExecutionMetadata(output)).toEqual({
      inputTokens: 120,
      outputTokens: 24,
      thoughtsTokens: 3,
      totalTokens: 147,
      modelVersion: "gemini-3.5-flash-lite-2026-07",
      responseId: "synthetic-response",
      finishReason: "STOP",
    });

    const request = requests[0];
    expect(request?.input).toContain(encodeURIComponent(model));
    expect(request?.input).not.toContain(apiKey);
    expect(new Headers(request?.init?.headers).get("x-goog-api-key")).toBe(apiKey);
    const body = JSON.parse(String(request?.init?.body));
    expect(body.generationConfig.responseFormat.text.mimeType).toBe("APPLICATION_JSON");
    expect(body.generationConfig.responseFormat.text.schema.required).toContain("category");
    expect(body.contents[0].parts[0].text).toContain("&lt;ignore&gt;");
    expect(body.contents[0].parts[0].text).toContain(
      "you do not need to know whether the knowledge base contains the answer",
    );
    expect(body.contents[0].parts[0].text).toContain(
      "Never use this category for a short but legitimate support or gallery question",
    );
    expect(body.contents[0].parts[0].text).toContain(
      "Confidence must be below 0.70 when the request has no concrete referent",
    );
  });

  it("creates a human-reviewed draft from exactly one approved source", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const provider = new GeminiProvider({
      apiKey,
      model,
      fetch: fakeFetch(requests, {
        subject: "Re: Encadrement",
        body: "Bonjour,\n\nL’encadrement est offert selon les conditions approuvées.\n\nBien à vous,\nDorian",
        language: "fr",
        knowledgeSourceIds: [knowledgeId],
        requiresHumanReview: true,
      }),
    });

    const output = await provider.generateDraft({
      subject: "Encadrement",
      cleanBody: "Bonjour, offrez-vous l’encadrement?",
      language: "fr",
      knowledge: [{
        id: knowledgeId,
        title: "Encadrement",
        answer: "L’encadrement est offert selon les conditions approuvées.",
      }],
      style: "DORIAN_REFERENCE",
    });

    expect(draftResultSchema.parse(output).knowledgeSourceIds).toEqual([knowledgeId]);
    const prompt = JSON.parse(String(requests[0]?.init?.body)).contents[0].parts[0].text;
    expect(prompt).toContain(`<id>${knowledgeId}</id>`);
    expect(prompt).toContain("Use only factual claims present in APPROVED_KNOWLEDGE");
  });

  it("rejects multiple grounding sources before making a request", async () => {
    const provider = new GeminiProvider({
      apiKey,
      model,
      fetch: async () => { throw new Error("should not be called"); },
    });

    await expect(provider.generateDraft({
      subject: "Question",
      cleanBody: "Question body",
      language: "en",
      knowledge: [
        { id: knowledgeId, title: "One", answer: "One" },
        { id: "b47e6b70-44c5-4fb1-b505-e30fd8c68c5b", title: "Two", answer: "Two" },
      ],
      style: "DORIAN_REFERENCE",
    })).rejects.toThrow("exactly one knowledge source");
  });

  it("reports free-tier throttling without exposing the response body", async () => {
    const provider = new GeminiProvider({
      apiKey,
      model,
      fetch: async () => new Response("private upstream details", { status: 429 }),
    });

    const promise = provider.classifyEmail({ subject: "Test", cleanBody: "Test" });
    await expect(promise).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    } satisfies Partial<GeminiProviderError>);
    await expect(promise).rejects.not.toThrow("private upstream details");
  });
});

function fakeFetch(
  requests: Array<{ input: string; init?: RequestInit }>,
  output: unknown,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(output) }] },
        finishReason: "STOP",
      }],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 24,
        thoughtsTokenCount: 3,
        totalTokenCount: 147,
      },
      modelVersion: "gemini-3.5-flash-lite-2026-07",
      responseId: "synthetic-response",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}
