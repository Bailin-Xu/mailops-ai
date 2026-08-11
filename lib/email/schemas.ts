import { z } from "zod";

export const emailParticipantTypeSchema = z.enum([
  "FROM",
  "TO",
  "CC",
  "BCC",
  "REPLY_TO",
]);

export const emailParticipantSchema = z
  .object({
    type: emailParticipantTypeSchema,
    displayName: z.string().nullable(),
    emailAddress: z.string().min(1),
    normalizedAddress: z.string().min(1),
  })
  .strict();

export const attachmentMetadataSchema = z
  .object({
    fileName: z.string().nullable(),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    contentId: z.string().nullable(),
    isInline: z.boolean(),
  })
  .strict();

export const parseWarningSchema = z.enum([
  "MISSING_MESSAGE_ID",
  "MISSING_SENT_DATE",
  "INVALID_SENT_DATE",
  "MISSING_SUBJECT",
  "MISSING_FROM",
  "MISSING_BODY",
  "HTML_ONLY_BODY",
]);

export const parsedEmailSchema = z
  .object({
    messageId: z.string().nullable(),
    inReplyTo: z.string().nullable(),
    references: z.array(z.string()),
    subject: z.string(),
    sentAt: z.date().nullable(),
    participants: z.array(emailParticipantSchema),
    textBody: z.string().nullable(),
    htmlBody: z.string().nullable(),
    normalizedBody: z.string(),
    attachments: z.array(attachmentMetadataSchema),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sourceFileName: z.string().min(1),
    parseStatus: z.enum(["PARSED", "PARSED_WITH_WARNINGS"]),
    parseWarnings: z.array(parseWarningSchema),
  })
  .strict();

export type EmailParticipantType = z.infer<typeof emailParticipantTypeSchema>;
export type EmailParticipant = z.infer<typeof emailParticipantSchema>;
export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;
export type ParseWarning = z.infer<typeof parseWarningSchema>;
export type ParsedEmail = z.infer<typeof parsedEmailSchema>;

export type EmlParseErrorCode =
  | "EMPTY_FILE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "MALFORMED_EMAIL"
  | "VALIDATION_FAILED";

export type EmlParseResult =
  | { status: "success"; email: ParsedEmail }
  | {
      status: "failed";
      error: { code: EmlParseErrorCode; message: string };
    };
