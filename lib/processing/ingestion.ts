import type { AIProvider } from "@/lib/ai/provider";
import { getDb } from "@/lib/db";
import {
  ingestEml,
  type IngestEmlOptions,
} from "@/lib/email/ingestion";
import { runThreadAutomation } from "@/lib/processing/service";

type AutomaticIngestionOptions = IngestEmlOptions & {
  provider: AIProvider;
};

export async function ingestAndProcessEml(
  input: Buffer,
  sourceFileName: string,
  options: AutomaticIngestionOptions,
) {
  const ingestion = await ingestEml(input, sourceFileName, options);
  if (ingestion.status !== "imported") {
    return { ingestion, processing: "NOT_STARTED" as const, classificationId: null };
  }

  const db = options.db ?? getDb();
  const message = await db.emailMessage.findUnique({
    where: { id: ingestion.messageId },
    select: { direction: true },
  });
  if (message?.direction !== "INBOUND") {
    return { ingestion, processing: "SKIPPED_NON_INBOUND" as const, classificationId: null };
  }

  try {
    const classification = await runThreadAutomation(
      ingestion.threadId,
      options.provider,
      db,
    );
    return {
      ingestion,
      processing: "COMPLETED" as const,
      classificationId: classification.id,
    };
  } catch {
    await db.emailThread.update({
      where: { id: ingestion.threadId },
      data: { status: "AUTOMATIC_PROCESSING_FAILED" },
    });
    return { ingestion, processing: "FAILED" as const, classificationId: null };
  }
}
