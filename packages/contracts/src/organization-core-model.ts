import {z} from "zod";
export const Binding=z.object({modelId:z.string().min(1).max(200),modelProvider:z.string().min(1).max(100),runtimeModelId:z.string().min(1).max(200),configRevision:z.string().min(1).max(200)}).strict();
export const State=z.object({version:z.number().int().nonnegative(),selection:Binding.nullable(),updatedBy:z.string().nullable(),reason:z.string().nullable()}).strict();
export const Candidate=z.object({modelId:Binding.shape.modelId,displayName:z.string(),modelProvider:Binding.shape.modelProvider.nullable(),runtimeModelId:Binding.shape.runtimeModelId.nullable(),configRevision:Binding.shape.configRevision.nullable(),available:z.boolean(),reason:z.string().nullable()}).strict().superRefine((row,ctx)=>{if(row.available&&(!row.modelProvider||!row.runtimeModelId||!row.configRevision))ctx.addIssue({code:"custom",message:"available model requires verified binding"});if(!row.available&&!row.reason)ctx.addIssue({code:"custom",message:"unavailable model requires reason"});});
export const SetInput=z.object({expectedVersion:z.number().int().nonnegative(),modelId:z.string().min(1).max(200),reason:z.string().trim().min(1).max(500)}).strict();
export const operations={
 get:{method:"GET",path:"/organization/core-model",in:z.object({}).strict(),out:State},
 candidates:{method:"GET",path:"/organization/core-model/candidates",in:z.object({}).strict(),out:z.array(Candidate)},
 set:{method:"PATCH",path:"/organization/core-model",in:SetInput,out:State},
} as const;
