import {z} from "zod";
import {PricingCatalog} from "./billing-pricing";
import {BillingOwnerType} from "./billing-credits";

export const CREDIT_ADMISSION_POLICY="personal_nonnegative_enterprise_overdraft" as const;
/** Legacy flag is retained for compatibility/audit; the fixed policy governs every new request. */
export const CreditConsumptionSettings=z.object({creditPreflightEnabled:z.boolean(),admissionPolicy:z.literal(CREDIT_ADMISSION_POLICY).optional()}).strict();
export const CreditConsumptionErrorCode=z.enum(["credit_required","credit_accounting_unavailable"]);
/** Only server-derived account identity and a same-origin billing destination are public. */
export const CreditRequiredBody=z.object({code:z.literal("credit_required"),ownerType:BillingOwnerType,
 ownerId:z.string().min(1),rechargePath:z.string().regex(/^\/billing(?:\?[^#]*)?$/),traceId:z.string().optional()}).strict();
export const operations={
 getSettings:{method:"GET",path:"/billing/consumption/settings",in:z.object({}).strict(),out:CreditConsumptionSettings},
 getPlatformSettings:{method:"GET",path:"/platform/billing/consumption/settings",in:z.object({}).strict(),out:CreditConsumptionSettings},
 updatePlatformSettings:{method:"PATCH",path:"/platform/billing/consumption/settings",in:CreditConsumptionSettings,out:CreditConsumptionSettings},
} as const;

/** Native quantities retain their real unit; these are configured credit tariffs, never invented tokens. */
export const CreditNativeUnit=z.enum(["image","pixel","millisecond","microsecond","character","request"]);
const PositiveIntegerString=z.string().regex(/^[1-9][0-9]{0,17}$/);
export const NativeCreditTariff=z.object({
 orgId:z.string().min(1).max(128),modelProvider:z.string().min(1).max(128),modelId:z.string().min(1).max(256),
 unit:CreditNativeUnit,quantum:PositiveIntegerString,hundredthsPerQuantum:PositiveIntegerString,version:z.string().min(1).max(128),
}).strict();
export const nativeTariffOperations={
 getImagePricingBasis:{method:'GET',path:'/platform/billing/consumption/image-pricing-basis',in:z.object({orgId:z.string().min(1).max(128)}).strict(),out:PricingCatalog},
 listNativeTariffs:{method:"GET",path:"/platform/billing/consumption/native-tariffs",in:z.object({orgId:z.string().min(1).max(128)}).strict(),out:z.object({items:z.array(NativeCreditTariff)}).strict()},
 upsertNativeTariff:{method:"PUT",path:"/platform/billing/consumption/native-tariffs",in:NativeCreditTariff,out:NativeCreditTariff},
} as const;

/** Global fixed image schedule: draft contract for #6268; no routes are active yet. */
export const GlobalImageModelId=z.enum(['z-image-turbo','qwen-image-3.0','qwen-image-3.0-pro']);
export const GLOBAL_IMAGE_CUSTOMER_FEN={'z-image-turbo':'25','qwen-image-3.0':'50','qwen-image-3.0-pro':'100'} as const;
const GlobalImageTariffRow=z.object({
 modelProvider:z.literal('bailian-image'),modelId:GlobalImageModelId,unit:z.literal('image'),
 customerAmountMinor:z.enum(['25','50','100']),currency:z.literal('CNY'),quantum:z.literal('1'),
 hundredthsPerQuantum:PositiveIntegerString,version:z.string().min(1).max(128),catalogVersion:z.string().min(1).max(128),
}).strict().superRefine((row,ctx)=>{
 if(row.customerAmountMinor!==GLOBAL_IMAGE_CUSTOMER_FEN[row.modelId])ctx.addIssue({code:z.ZodIssueCode.custom,message:'fixed_image_price_mismatch',path:['customerAmountMinor']});
});
export const GlobalImageTariffSchedule=z.object({scope:z.literal('global'),revision:z.string().min(1).max(128).nullable(),items:z.array(GlobalImageTariffRow)}).strict().superRefine((schedule,ctx)=>{
 if(schedule.revision===null ? schedule.items.length!==0 : schedule.items.length!==3||new Set(schedule.items.map(row=>row.modelId)).size!==3||new Set(schedule.items.map(row=>row.catalogVersion)).size!==1)
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'complete_global_image_schedule_required',path:['items']});
});
export const ActivateGlobalImageTariffs=z.object({expectedRevision:z.string().min(1).max(128).nullable(),expectedCatalogVersion:z.string().min(1).max(128)}).strict();
export const globalImageTariffOperations={
 list:{method:'GET',path:'/platform/billing/consumption/global-native-tariffs',in:z.object({}).strict(),out:GlobalImageTariffSchedule},
 activate:{method:'PUT',path:'/platform/billing/consumption/global-native-tariffs',in:ActivateGlobalImageTariffs,out:GlobalImageTariffSchedule},
} as const;
