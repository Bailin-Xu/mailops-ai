"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import {
  KnowledgeSourceReviewError,
  saveKnowledgeSourceReview,
} from "@/lib/knowledge/review-source";

type ReviewActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function reviewKnowledgeSourceAction(
  _previousState: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  try {
    const result = await saveKnowledgeSourceReview({
      messageId: formData.get("messageId"),
      decision: formData.get("decision"),
      note: formData.get("note"),
    });

    revalidatePath("/knowledge-sources");

    return {
      status: "success",
      message: `Saved as ${result.knowledgeReviewStatus.toLowerCase().replaceAll("_", " ")}.`,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        status: "error",
        message: error.issues[0]?.message ?? "Check the review details and try again.",
      };
    }

    return {
      status: "error",
      message:
        error instanceof KnowledgeSourceReviewError
          ? error.message
          : "The review could not be saved. Refresh the page and try again.",
    };
  }
}
