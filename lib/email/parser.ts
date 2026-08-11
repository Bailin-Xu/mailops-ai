import { basename, extname } from "node:path";

import { convert } from "html-to-text";
import PostalMime, { type Attachment, type Email } from "postal-mime";

import { createEmailFingerprint } from "@/lib/email/fingerprint";
import {
  normalizeMessageId,
  normalizeText,
  parseReferences,
  toParticipants,
} from "@/lib/email/normalize";
import {
  parsedEmailSchema,
  type EmlParseResult,
  type ParseWarning,
} from "@/lib/email/schemas";

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

type ParseEmlOptions = {
  maxFileBytes?: number;
};

export async function parseEml(
  input: Buffer,
  sourceFileName: string,
  options: ParseEmlOptions = {},
): Promise<EmlParseResult> {
  const safeFileName = basename(sourceFileName);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  if (extname(safeFileName).toLowerCase() !== ".eml") {
    return failure("UNSUPPORTED_FILE_TYPE", "Only .eml files are supported.");
  }

  if (input.byteLength === 0) {
    return failure("EMPTY_FILE", "The email file is empty.");
  }

  if (input.byteLength > maxFileBytes) {
    return failure("FILE_TOO_LARGE", `The email file exceeds the ${maxFileBytes} byte limit.`);
  }

  if (!hasRecognizableHeaderBlock(input)) {
    return failure("MALFORMED_EMAIL", "The file does not contain a recognizable email header block.");
  }

  let parsed: Email;
  try {
    parsed = await PostalMime.parse(input, {
      attachmentEncoding: "arraybuffer",
      maxHeadersSize: 1024 * 1024,
      maxNestingDepth: 50,
      maxRfc822NestingDepth: 5,
    });
  } catch {
    return failure("MALFORMED_EMAIL", "The email content could not be parsed.");
  }

  const warnings: ParseWarning[] = [];
  const messageId = normalizeMessageId(parsed.messageId);
  const subject = parsed.subject?.trim() || "(no subject)";
  const sentAt = parseSentAt(parsed.date, warnings);
  const textBody = parsed.text ?? null;
  const htmlBody = parsed.html ?? null;

  if (!messageId) warnings.push("MISSING_MESSAGE_ID");
  if (!parsed.subject?.trim()) warnings.push("MISSING_SUBJECT");

  const participants = [
    ...toParticipants("FROM", parsed.from),
    ...toParticipants("TO", parsed.to),
    ...toParticipants("CC", parsed.cc),
    ...toParticipants("BCC", parsed.bcc),
    ...toParticipants("REPLY_TO", parsed.replyTo),
  ];

  if (!participants.some((participant) => participant.type === "FROM")) {
    warnings.push("MISSING_FROM");
  }

  let normalizedBody = "";
  if (textBody) {
    normalizedBody = normalizeText(textBody);
  } else if (htmlBody) {
    normalizedBody = normalizeText(
      convert(htmlBody, {
        selectors: [
          { selector: "img", format: "skip" },
          { selector: "script", format: "skip" },
          { selector: "style", format: "skip" },
        ],
        wordwrap: false,
      }),
    );
    warnings.push("HTML_ONLY_BODY");
  } else {
    warnings.push("MISSING_BODY");
  }

  const parsedEmail = {
    messageId,
    inReplyTo: normalizeMessageId(parsed.inReplyTo),
    references: parseReferences(parsed.references),
    subject,
    sentAt,
    participants,
    textBody,
    htmlBody,
    normalizedBody,
    attachments: parsed.attachments.map(toAttachmentMetadata),
    fingerprint: createEmailFingerprint({
      subject,
      sentAt,
      normalizedBody,
      participants,
    }),
    sourceFileName: safeFileName,
    parseStatus: warnings.length === 0 ? "PARSED" : "PARSED_WITH_WARNINGS",
    parseWarnings: warnings,
  };

  const validated = parsedEmailSchema.safeParse(parsedEmail);
  if (!validated.success) {
    return failure("VALIDATION_FAILED", "The parsed email did not match the application schema.");
  }

  return { status: "success", email: validated.data };
}

function parseSentAt(value: string | undefined, warnings: ParseWarning[]): Date | null {
  if (!value) {
    warnings.push("MISSING_SENT_DATE");
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    warnings.push("INVALID_SENT_DATE");
    return null;
  }

  return date;
}

function toAttachmentMetadata(attachment: Attachment) {
  return {
    fileName: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: getAttachmentSize(attachment),
    contentId: attachment.contentId?.trim() || null,
    isInline: attachment.disposition === "inline" || attachment.related === true,
  };
}

function getAttachmentSize(attachment: Attachment): number {
  if (typeof attachment.content === "string") {
    return Buffer.byteLength(
      attachment.content,
      attachment.encoding === "base64" ? "base64" : "utf8",
    );
  }

  return attachment.content.byteLength;
}

function hasRecognizableHeaderBlock(input: Buffer): boolean {
  const headerSample = input.subarray(0, Math.min(input.byteLength, 64 * 1024)).toString("latin1");
  const normalized = headerSample.replace(/\r\n?/g, "\n");

  return /(?:^|\n)[A-Za-z0-9][A-Za-z0-9-]*:[^\n]*(?:\n|$)/.test(normalized) && normalized.includes("\n\n");
}

function failure(
  code: "EMPTY_FILE" | "UNSUPPORTED_FILE_TYPE" | "FILE_TOO_LARGE" | "MALFORMED_EMAIL" | "VALIDATION_FAILED",
  message: string,
): EmlParseResult {
  return { status: "failed", error: { code, message } };
}
