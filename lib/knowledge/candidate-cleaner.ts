import { normalizeText } from "@/lib/email/normalize";

export const candidateCleaningReasonValues = [
  "GREETING",
  "SIGNATURE",
  "CONTACT_DETAILS",
  "PERSON_NAME",
  "MESSAGE_ARTIFACT",
  "QUESTION_FOCUS",
] as const;

export type CandidateCleaningReason =
  (typeof candidateCleaningReasonValues)[number];

export type CleanKnowledgeCandidateResult = {
  canonicalQuestion: string;
  proposedAnswer: string;
  reasons: CandidateCleaningReason[];
};

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_PATTERN = /(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]\d{4}/g;
const URL_PATTERN = /(?:<)?https?:\/\/[^\s<>]+(?:>)?/giu;
const SOCIAL_PATTERN = /(^|\s)@[\p{L}\d._-]{2,}/gu;
const MOBILE_FOOTER_PATTERN = /(?:^|\n)(?:envoyé de mon|envoyé depuis mon|sent from my|get outlook for|yahoo courriel)\b[\s\S]*$/iu;
const SIGN_OFF_PATTERN = /(?:^|\n)\s*(?:merci(?: beaucoup)?|bonne journée|au plaisir|cordialement|bien cordialement|salutations|best regards|kind regards|regards|sincerely)[,!\s]*\n[\s\S]*$/iu;
const TRAILING_POLITENESS_PATTERN = /(?:,?\s+|\n)(?:merci(?: beaucoup)?|bonne journée|au plaisir|cordialement|bien cordialement|salutations|best regards|kind regards|regards|sincerely)[,!.\s]*$/iu;
const ATTACHMENT_PATTERN = /\[(?:image|video|pièce jointe|attachment)[^\]]*\]|\b[^\s<>]+\.(?:mov|mp4|png|jpe?g|gif|pdf|docx?|xlsx?)\b/giu;
const PERSON_AFTER_CONTACT_PATTERN = /(\b(?:avec|contacté|contactée|parlé à|discuté avec|échangé avec)\s+)([\p{Lu}][\p{L}'’.-]{1,40})\b/gu;
const BUSINESS_NAMES = new Set(["artsy", "galerie", "l’original", "l'original", "montréal", "pickart"]);

export function cleanKnowledgeCandidate(input: {
  title: string;
  canonicalQuestion: string;
  proposedAnswer: string;
  knownNames?: string[];
}): CleanKnowledgeCandidateResult {
  const reasons = new Set<CandidateCleaningReason>();
  const question = cleanCandidateText(input.canonicalQuestion, reasons, input.knownNames ?? []);
  const answer = cleanCandidateText(input.proposedAnswer, reasons, input.knownNames ?? []);
  const focusedQuestion = focusExplicitQuestions(question);
  if (focusedQuestion !== question) reasons.add("QUESTION_FOCUS");

  return {
    canonicalQuestion:
      focusedQuestion || `Question générale concernant « ${input.title.trim()} »`,
    proposedAnswer: answer,
    reasons: [...reasons],
  };
}

function cleanCandidateText(
  value: string,
  reasons: Set<CandidateCleaningReason>,
  knownNames: string[],
) {
  let result = normalizeText(value);

  const withoutGreeting = stripGreeting(result);
  if (withoutGreeting !== result) reasons.add("GREETING");
  result = withoutGreeting;

  const withoutSignature = result
    .replace(MOBILE_FOOTER_PATTERN, "")
    .replace(SIGN_OFF_PATTERN, "")
    .replace(TRAILING_POLITENESS_PATTERN, "");
  if (withoutSignature !== result) reasons.add("SIGNATURE");
  result = withoutSignature;

  const withoutContactDetails = result
    .replace(EMAIL_PATTERN, " ")
    .replace(PHONE_PATTERN, " ")
    .replace(URL_PATTERN, " ")
    .replace(SOCIAL_PATTERN, "$1");
  if (withoutContactDetails !== result) reasons.add("CONTACT_DETAILS");
  result = withoutContactDetails;

  const withoutArtifacts = result
    .replace(ATTACHMENT_PATTERN, " ")
    .replace(/<mailto:[^>]+>/giu, " ");
  if (withoutArtifacts !== result) reasons.add("MESSAGE_ARTIFACT");
  result = withoutArtifacts;

  const withoutKnownNames = replaceKnownNames(result, knownNames);
  const withoutContactNames = withoutKnownNames.replace(
    PERSON_AFTER_CONTACT_PATTERN,
    (match, prefix: string, name: string) =>
      BUSINESS_NAMES.has(name.toLocaleLowerCase()) ? match : `${prefix}l’équipe`,
  );
  if (withoutContactNames !== result) reasons.add("PERSON_NAME");

  return normalizeCandidateWhitespace(withoutContactNames);
}

function stripGreeting(value: string) {
  const lines = value.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  if (!/^(?:bonjour|bonsoir|salut|allô|hello|hi)\b/iu.test(firstLine)) {
    return value;
  }

  const greetingOnly = /^(?:[Bb]onjour|[Bb]onsoir|[Ss]alut|[Aa]llô|[Hh]ello|[Hh]i)(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}\s*[,!:]?$/u;
  if (greetingOnly.test(firstLine)) return lines.slice(1).join("\n").trimStart();

  return value.replace(
    /^(?:[Bb]onjour|[Bb]onsoir|[Ss]alut|[Aa]llô|[Hh]ello|[Hh]i)(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}\s*[,!:]\s*/u,
    "",
  );
}

function replaceKnownNames(value: string, knownNames: string[]) {
  return knownNames
    .map((name) => name.trim())
    .filter((name) => name.length >= 2)
    .reduce((current, name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return current.replace(new RegExp(`\\b${escaped}\\b`, "giu"), "");
    }, value);
}

function focusExplicitQuestions(value: string) {
  const questions = value.match(/(?:^|[.!]\s+|\n+)([^?]{5,500}\?)/gu);
  if (!questions?.length) return value;

  const focused = questions
    .map((question) => question.replace(/^(?:[.!]\s+|\n+)/u, "").trim())
    .join("\n");
  return focused.length >= 10 ? focused : value;
}

function normalizeCandidateWhitespace(value: string) {
  return normalizeText(
    value
      .split("\n")
      .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"),
  );
}
