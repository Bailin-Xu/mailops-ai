"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { saveWebsiteKnowledgeReview } from "@/lib/knowledge/website-review";

type WebsiteReviewActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function reviewWebsiteKnowledgeAction(
  _previousState: WebsiteReviewActionState,
  formData: FormData,
): Promise<WebsiteReviewActionState> {
  try {
    const result = await saveWebsiteKnowledgeReview({
      reviewItemId: formData.get("reviewItemId"),
      decision: formData.get("decision"),
      confirmedAnswer: formData.get("confirmedAnswer"),
      note: formData.get("note"),
    });

    revalidatePath("/website-knowledge");

    return {
      status: "success",
      message: `Saved as ${result.status.toLowerCase().replaceAll("_", " ")}.`,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        status: "error",
        message:
          error.issues[0]?.message ?? "Check the confirmed policy and try again.",
      };
    }

    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "The website review could not be saved.",
    };
  }
}
