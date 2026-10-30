import {z} from "zod";
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
 listNativeTariffs:{method:"GET",path:"/platform/billing/consumption/native-tariffs",in:z.object({orgId:z.string().min(1).max(128)}).strict(),out:z.object({items:z.array(NativeCreditTariff)}).strict()},
 upsertNativeTariff:{method:"PUT",path:"/platform/billing/consumption/native-tariffs",in:NativeCreditTariff,out:NativeCreditTariff},
} as const;
