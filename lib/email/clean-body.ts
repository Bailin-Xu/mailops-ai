import { normalizeText } from "@/lib/email/normalize";

export const cleanBodyRemovalReasonValues = [
  "QUOTED_HISTORY",
  "CONFIDENTIALITY_NOTICE",
  "SIGNATURE",
  "INLINE_ARTIFACT",
] as const;

export type CleanBodyRemovalReason =
  (typeof cleanBodyRemovalReasonValues)[number];

export type CleanEmailBodyResult = {
  cleanBody: string;
  quotedContext: string | null;
  removalReasons: CleanBodyRemovalReason[];
};

type CutoffPattern = {
  pattern: RegExp;
  reason: CleanBodyRemovalReason;
};

const QUOTE_CUTOFF_PATTERNS: readonly CutoffPattern[] = [
  {
    pattern:
      /(?:^|\n|_{5,}\s*)(?:-{2,}\s*)?(?:original message|message d['’]origine)(?:\s*-{2,})?/i,
    reason: "QUOTED_HISTORY",
  },
  {
    pattern: /(?:^|\n)-{5,}\s*(?:forwarded message|message transféré)\s*-{5,}/i,
    reason: "QUOTED_HISTORY",
  },
  {
    pattern: /_{5,}\s*(?=(?:de|from)\s*:)/i,
    reason: "QUOTED_HISTORY",
  },
  {
    pattern:
      /(?:^|\n)(?:on(?:\s|$)[^\n]{0,500}\bwrote\s*:|le(?:\s|$)[^\n]{0,500}\ba écrit\s*:)/i,
    reason: "QUOTED_HISTORY",
  },
  {
    pattern:
      /(?:^|\n)(?=(?:from|de)\s*:[^\n]*(?:\n(?:sent|envoyé)\s*:[^\n]*)?(?:\n(?:to|à)\s*:[^\n]*)?(?:\n(?:subject|objet)\s*:))/i,
    reason: "QUOTED_HISTORY",
  },
];

const HARD_CUTOFF_PATTERNS: readonly CutoffPattern[] = [
  ...QUOTE_CUTOFF_PATTERNS,
  {
    pattern:
      /(?:^|\n|\s)(?:note de confidentialité|avis de confidentialité|confidentiality (?:note|notice))\s*:/i,
    reason: "CONFIDENTIALITY_NOTICE",
  },
];

const SIGNATURE_CUTOFF_PATTERNS: readonly RegExp[] = [
  /(?:^|\n)--\s*(?:\n|$)/,
  /(?:^|\n)(?:sent from my|envoyé de mon|envoyé depuis mon|get outlook for)\b/i,
];

const SIGN_OFF_LINE =
  /(?:^|\n)(?:au plaisir|bien cordialement|cordialement|best regards|kind regards|warm regards|regards|sincerely)\s*[,!.]?\s*(?=\n|$)/gi;

const PROFESSIONAL_TITLE_PATTERN =
  /\b(?:chief|ceo|founder|director|executive director|directeur|directrice|chef(?:\s+exécutif|\s+executif)?|commissaire|conservateur|curator|manager|gestionnaire)\b/i;
const PHONE_PATTERN =
  /\b(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]\d{4}\b/;
const STREET_ADDRESS_PATTERN =
  /\b\d{1,6}\s+(?:rue|street|st\.?|avenue|ave\.?|boulevard|blvd\.?)\b/i;
const CONFIDENTIALITY_PATTERN =
  /\b(?:note de confidentialité|avis de confidentialité|confidentiality (?:note|notice))\b/i;
const WEB_LINK_PATTERN = /<https?:\/\/[^>\n]+>|https?:\/\/[^\s<>]+/gi;

export function cleanEmailBody(value: string): CleanEmailBodyResult {
  const normalizedBody = normalizeText(value);
  const quotedContext = extractQuotedContext(normalizedBody);
  const { body, reasons } = cleanCurrentBody(normalizedBody);

  return {
    cleanBody: body,
    quotedContext,
    removalReasons: [...reasons],
  };
}

function cleanCurrentBody(value: string) {
  let body = value;
  const reasons = new Set<CleanBodyRemovalReason>();

  const hardCutoff = findEarliestCutoff(body, HARD_CUTOFF_PATTERNS);
  if (hardCutoff) {
    body = body.slice(0, hardCutoff.index);
    reasons.add(hardCutoff.reason);
  }

  const signatureCutoff = findEarliestPatternIndex(body, SIGNATURE_CUTOFF_PATTERNS);
  const signOffCutoff = findTrailingSignOff(body);
  const professionalSignatureCutoff = findProfessionalSignatureStart(body);
  const earliestSignatureCutoff = minimumIndex(
    minimumIndex(signatureCutoff, signOffCutoff),
    professionalSignatureCutoff,
  );
  if (earliestSignatureCutoff !== null) {
    body = body.slice(0, earliestSignatureCutoff);
    reasons.add("SIGNATURE");
  }

  const withoutQuotedLines = body
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  if (withoutQuotedLines !== body) {
    body = withoutQuotedLines;
    reasons.add("QUOTED_HISTORY");
  }

  const withoutInlineArtifacts = body
    .replace(/\[\s*cid:[^\]\r\n]+\]/gi, " ")
    .replace(/(?:^|\s)cid:[^\s<>]+/gi, " ")
    .replace(/[ \t]{2,}/g, " ");
  if (withoutInlineArtifacts !== body) {
    body = withoutInlineArtifacts;
    reasons.add("INLINE_ARTIFACT");
  }

  return { body: normalizeText(body), reasons };
}

function extractQuotedContext(value: string): string | null {
  const quoteStart = findEarliestCutoff(value, QUOTE_CUTOFF_PATTERNS);
  if (!quoteStart) return null;

  const matchedMarker = QUOTE_CUTOFF_PATTERNS.map((candidate) => ({
    candidate,
    match: candidate.pattern.exec(value),
  }))
    .filter(
      (entry): entry is { candidate: CutoffPattern; match: RegExpExecArray } =>
        entry.match !== null && entry.match.index === quoteStart.index,
    )
    .sort((first, second) => second.match[0].length - first.match[0].length)[0];

  if (!matchedMarker) return null;

  const rawContext = value.slice(
    matchedMarker.match.index + matchedMarker.match[0].length,
  );
  const unquoted = rawContext
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n");
  const withoutHeaders = stripLeadingOutlookHeaders(unquoted);
  const cleaned = cleanCurrentBody(normalizeText(withoutHeaders)).body;

  return cleaned || null;
}

function stripLeadingOutlookHeaders(value: string): string {
  const lines = value.split("\n");
  const headerWindow = lines.slice(0, 10);
  const fromIndex = headerWindow.findIndex((line) => /^(?:from|de)\s*:/i.test(line));
  const subjectIndex = headerWindow.findIndex((line) =>
    /^(?:subject|objet)\s*:/i.test(line),
  );

  if (fromIndex >= 0 && subjectIndex >= fromIndex && subjectIndex < lines.length - 1) {
    return lines.slice(subjectIndex + 1).join("\n");
  }

  return value;
}

function findEarliestCutoff(
  value: string,
  candidates: readonly CutoffPattern[],
) {
  let result: { index: number; reason: CleanBodyRemovalReason } | null = null;

  for (const candidate of candidates) {
    const match = candidate.pattern.exec(value);
    if (match && (result === null || match.index < result.index)) {
      result = { index: match.index, reason: candidate.reason };
    }
  }

  return result;
}

function findEarliestPatternIndex(value: string, patterns: readonly RegExp[]) {
  let result: number | null = null;

  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match && (result === null || match.index < result)) {
      result = match.index;
    }
  }

  return result;
}

function findTrailingSignOff(value: string): number | null {
  SIGN_OFF_LINE.lastIndex = 0;

  let result: number | null = null;
  for (const match of value.matchAll(SIGN_OFF_LINE)) {
    const index = match.index;
    if (index === undefined) continue;

    const contentBefore = value.slice(0, index).trim();
    const contentAfter = value.slice(index + match[0].length).trim();
    if (contentBefore.length >= 3 && looksLikeSignatureSuffix(contentAfter)) {
      result = index;
      break;
    }
  }

  return result;
}

function findProfessionalSignatureStart(value: string): number | null {
  WEB_LINK_PATTERN.lastIndex = 0;

  for (const match of value.matchAll(WEB_LINK_PATTERN)) {
    const matchIndex = match.index;
    if (matchIndex === undefined) continue;

    const suffix = value.slice(matchIndex + match[0].length, matchIndex + 1200);
    const titleMatch = PROFESSIONAL_TITLE_PATTERN.exec(suffix);
    if (!titleMatch || titleMatch.index > 250) continue;

    const contentBeforeTitle = suffix.slice(0, titleMatch.index);
    WEB_LINK_PATTERN.lastIndex = 0;
    if (WEB_LINK_PATTERN.test(contentBeforeTitle)) continue;

    const hasContactSignal =
      PHONE_PATTERN.test(suffix) ||
      STREET_ADDRESS_PATTERN.test(suffix) ||
      CONFIDENTIALITY_PATTERN.test(suffix);
    if (!hasContactSignal) continue;

    return expandSignatureBoundary(value, matchIndex);
  }

  return null;
}

function expandSignatureBoundary(value: string, index: number): number {
  const lineStart = value.lastIndexOf("\n", index - 1) + 1;
  const contentOnLinkLine = value.slice(lineStart, index).trim();
  const meaningfulContentOnLinkLine = contentOnLinkLine
    .replace(/\[\s*cid:[^\]\r\n]+\]/gi, "")
    .trim();
  if (meaningfulContentOnLinkLine.length > 0) return lineStart;

  const prefix = value.slice(0, lineStart).trimEnd();
  const previousLineStart = prefix.lastIndexOf("\n") + 1;
  const previousLine = prefix.slice(previousLineStart).trim();

  return /^(?:[\p{L}][.'’]?|[\p{Lu}]{1,3})$/u.test(previousLine)
    ? previousLineStart
    : lineStart;
}

function looksLikeSignatureSuffix(value: string): boolean {
  if (!value) return false;
  if (
    PROFESSIONAL_TITLE_PATTERN.test(value) &&
    (PHONE_PATTERN.test(value) ||
      STREET_ADDRESS_PATTERN.test(value) ||
      CONFIDENTIALITY_PATTERN.test(value))
  ) {
    return true;
  }

  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 4) return false;

  const firstLine = lines[0] ?? "";
  return (
    firstLine.length <= 60 &&
    firstLine.split(/\s+/).length <= 4 &&
    !/[?!]/.test(firstLine) &&
    !/\.$/.test(firstLine)
  );
}

function minimumIndex(first: number | null, second: number | null) {
  if (first === null) return second;
  if (second === null) return first;
  return Math.min(first, second);
}
