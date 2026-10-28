"use server";
import { revalidatePath } from "next/cache";
import { retireKnowledge } from "@/lib/knowledge/revisions";
import { WorkflowConflictError } from "@/lib/workflow/transaction";
export async function retireKnowledgeAction(_state: { message: string; error: boolean }, form: FormData) {
  try {
    await retireKnowledge({ knowledgeEntryId: form.get("knowledgeEntryId"), expectedRevisionId: form.get("expectedRevisionId"), status: form.get("status"), note: form.get("note") });
    for (const path of ["/inbox", "/knowledge-candidates", "/knowledge-search"]) revalidatePath(path);
    revalidatePath("/knowledge/[id]", "page");
    return { message: "Knowledge retired. Pending replies require review; confirmed history is unchanged.", error: false };
  } catch (error) {
    return { message: error instanceof WorkflowConflictError ? error.message : "Knowledge could not be retired. Your note is kept; reload the latest version and retry.", error: true };
  }
}
