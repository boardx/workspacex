import {z} from "zod";
import {NATIVE_UNITS} from "./ai-usage";
/** Decimal integers avoid float rounding and remain bounded by PostgreSQL bigint. */
export const Micros = z.string().regex(/^(0|[1-9]\d{0,18})$/).refine(value=>/^(0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n);
const Timezone=z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}},"invalid timezone");
export const Window=z.object({start:z.string().datetime({offset:true}),end:z.string().datetime({offset:true}),timezone:Timezone}).strict()
 .refine(value=>Date.parse(value.end)>Date.parse(value.start)&&Date.parse(value.end)-Date.parse(value.start)<=366*86400000,"invalid window");
/** Compatibility boundary for the existing member quota authority. */
export function isUtcCalendarMonthWindow(window:z.infer<typeof Window>):boolean {
 const start=new Date(window.start),end=new Date(window.end);
 return ["Etc/UTC","UTC"].includes(window.timezone)&&start.getUTCDate()===1
  &&start.getUTCHours()===0&&start.getUTCMinutes()===0&&start.getUTCSeconds()===0&&start.getUTCMilliseconds()===0
  &&end.getTime()===Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1);
}
export const ChatModelPrice=z.object({modelId:z.string().min(1).max(200),modelProvider:z.string().min(1).max(100),
 /** Pool IDs and provider API model identifiers are different; never infer from a display name. */
 runtimeModelId:z.string().min(1).max(200),
 inputMicrosPerMillion:Micros,outputMicrosPerMillion:Micros,cachedInputMicrosPerMillion:Micros,
 maxInputTokens:z.number().int().positive().max(2147483647),maxOutputTokens:z.number().int().positive().max(2147483647),
}).strict();
/** Input-only is explicit: output caps/rates are not applicable, never guessed as zero. */
export const InputOnlyModelPrice=z.object({billingMode:z.literal("input-only"),modelId:z.string().min(1).max(200),
 modelProvider:z.string().min(1).max(100),runtimeModelId:z.string().min(1).max(200),
 inputMicrosPerMillion:Micros,cachedInputMicrosPerMillion:Micros,
 maxInputTokens:z.number().int().positive().max(2147483647),
}).strict();
export const ModelPrice=z.union([ChatModelPrice,InputOnlyModelPrice]);
/** Separate native dimensions never manufacture Token caps or rates. */
export const NativeModelPrice=z.object({modelId:z.string().min(1).max(200),modelProvider:z.string().min(1).max(100),
 runtimeModelId:z.string().min(1).max(200),unit:z.enum(NATIVE_UNITS),
 quantum:Micros.refine(value=>/^[0-9]+$/.test(value)&&BigInt(value)>0n),microsPerQuantum:Micros.refine(value=>/^[0-9]+$/.test(value)&&BigInt(value)>0n),
 maxQuantity:Micros.refine(value=>/^[0-9]+$/.test(value)&&BigInt(value)>0n),
}).strict();
/** Optional controls preserve legacy configurations without enabling inferred thresholds. */
export const TokenControls=z.object({
 enforceLimitRules:z.boolean().optional(),
 quotaSource:z.enum(["organization-template","member-monthly-utc"]),
 warningAtTokens:Micros.nullable(),degradeAtTokens:Micros.nullable(),
 memberOverrides:z.array(z.object({userId:z.string().min(1).max(200),tokens:Micros}).strict()).max(500),
}).strict().superRefine((value,ctx)=>{
 if(new Set(value.memberOverrides.map(row=>row.userId)).size!==value.memberOverrides.length)
  ctx.addIssue({code:z.ZodIssueCode.custom,message:"duplicate member quota override"});
 if(value.quotaSource==="member-monthly-utc"&&value.memberOverrides.length)
  ctx.addIssue({code:z.ZodIssueCode.custom,message:"member quota authority cannot have template overrides"});
 if(value.warningAtTokens!==null&&value.degradeAtTokens!==null&&BigInt(value.warningAtTokens)>BigInt(value.degradeAtTokens))
  ctx.addIssue({code:z.ZodIssueCode.custom,message:"warning exceeds degradation threshold"});
});
export const Configuration=z.object({tokenControls:TokenControls.optional(),window:Window,ordinaryTokensPerUser:Micros.nullable(),costMicrosPerUser:Micros,
 currency:z.string().regex(/^[A-Z]{3}$/),prices:z.array(ModelPrice).min(1).max(50),
 nativePrices:z.array(NativeModelPrice).max(50).optional(),
 /** Empty means no fallback. Attempts include the primary; SDK retry admission is separate. */
 fallbackModelIds:z.array(z.string().min(1).max(200)).max(4),maxAttempts:z.number().int().min(1).max(5),
}).strict().superRefine((value,ctx)=>{
 if(value.tokenControls?.quotaSource==="member-monthly-utc"&&!isUtcCalendarMonthWindow(value.window))
  ctx.addIssue({code:z.ZodIssueCode.custom,message:"member quota requires a complete UTC calendar month"});
 const ids=value.prices.map(row=>row.modelId);
 const bindings=value.prices.map(row=>JSON.stringify([row.modelProvider,row.runtimeModelId]));
 const allIds=[...ids,...(value.nativePrices??[]).map(row=>row.modelId)];
 const allBindings=[...bindings,...(value.nativePrices??[]).map(row=>JSON.stringify([row.modelProvider,row.runtimeModelId]))];
 if(new Set(allIds).size!==allIds.length||new Set(allBindings).size!==allBindings.length)
  ctx.addIssue({code:z.ZodIssueCode.custom,message:"duplicate native model binding"});
 if(new Set(ids).size!==ids.length||new Set(value.fallbackModelIds).size!==value.fallbackModelIds.length
  ||new Set(bindings).size!==bindings.length||value.fallbackModelIds.some(id=>!ids.includes(id)))ctx.addIssue({code:z.ZodIssueCode.custom,message:"invalid model references"});
 if(value.maxAttempts>value.fallbackModelIds.length+1)ctx.addIssue({code:z.ZodIssueCode.custom,message:"attempts exceed authorized candidates"});
});
export const State=z.object({version:z.number().int().nonnegative(),configuration:Configuration.nullable(),
 priceVersion:z.string().nullable(),updatedAt:z.string().nullable(),updatedBy:z.string().nullable(),enforcement:z.literal("pending"),
 changes:z.array(z.object({version:z.number().int().positive(),actorId:z.string(),changedAt:z.string(),reason:z.string()}).strict()).max(50),
}).strict().superRefine((value,ctx)=>{
 if((value.version===0&&(value.configuration!==null||value.priceVersion!==null||value.updatedAt!==null||value.updatedBy!==null))
  ||(value.version>0&&(value.configuration===null||!value.priceVersion||!value.updatedAt||!value.updatedBy)))
  ctx.addIssue({code:z.ZodIssueCode.custom,message:"inconsistent policy state"});
});
export const SetInput=z.object({expectedVersion:z.number().int().min(0).max(2147483646),reason:z.string().trim().min(1).max(500),configuration:Configuration}).strict();
export const Candidate=z.object({modelId:z.string(),displayName:z.string(),kind:z.enum(["closed-api","self-hosted"]),
 capabilityTags:z.array(z.string()),contextWindow:z.number().int().positive(),modelProviders:z.array(z.string()).max(50)}).strict();
