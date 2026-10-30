import { z } from "zod";
import { proposalSchema } from "@/contracts/agent/schema";
export const previewSchema=z.strictObject({proposal:proposalSchema.nullable(),modelCalls:z.number().int().min(0).max(6).nullable(),toolCalls:z.number().int().min(0).max(8).nullable(),steps:z.array(z.enum(["Search","Inspect"])).max(8),code:z.string().max(80)});
export type AgentUiView={id:string;status:string;revision:number;leaseActive:boolean;preview:z.infer<typeof previewSchema>|null;stale:boolean;
 evidence:{entryId:string;revisionId:string;version:number;title:string;answer:string;language:string;current:boolean}|null;draftId:string|null};
