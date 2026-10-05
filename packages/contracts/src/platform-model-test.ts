import {z} from "zod";
import {Micros} from "./ai-policy";
import {NATIVE_UNITS} from "./ai-usage";
export const PlatformModelTestCapability=z.enum(["text","image-generation","text-to-speech","speech-to-text","embedding","rerank"]);
const Positive=Micros.refine(value=>/^(0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)>0n);
const Base=z.object({testId:z.string().uuid(),orgId:z.string().min(1).max(200),modelId:z.string().min(1).max(200),declaredNonConfidential:z.literal(true)});
const Bounds=z.object({maximumCostMicros:Positive,timeoutMs:z.number().int().min(1).max(60000)}).strict();
export const PlatformModelTestRequest=z.discriminatedUnion("capability",[
 Base.extend({capability:z.literal("text"),input:z.object({prompt:z.string().trim().min(1).max(10000)}).strict(),bounds:Bounds.extend({maxOutputTokens:z.number().int().positive().max(8192)}).strict()}).strict(),
 Base.extend({capability:z.literal("image-generation"),input:z.object({prompt:z.string().trim().min(1).max(4000)}).strict(),bounds:Bounds.extend({maximumQuantity:Positive}).strict()}).strict(),
 Base.extend({capability:z.literal("text-to-speech"),input:z.object({text:z.string().min(1).max(2000),voice:z.string().min(1).max(100),language:z.string().max(100).optional()}).strict(),bounds:Bounds.extend({maximumQuantity:Positive}).strict()}).strict(),
 Base.extend({capability:z.literal("speech-to-text"),input:z.object({audioBase64:z.string().min(4).max(3000000).regex(/^[A-Za-z0-9+/]+={0,2}$/),sampleRateHz:z.union([z.literal(16000),z.literal(24000)]),channels:z.literal(1),format:z.literal("pcm16")}).strict(),bounds:Bounds.extend({maximumQuantity:Positive}).strict()}).strict(),
 Base.extend({capability:z.literal("embedding"),input:z.object({texts:z.array(z.string().min(1).max(2000)).min(1).max(8)}).strict(),bounds:Bounds}).strict(),
 Base.extend({capability:z.literal("rerank"),input:z.object({query:z.string().min(1).max(2000),documents:z.array(z.string().min(1).max(2000)).min(1).max(20)}).strict(),bounds:Bounds}).strict(),
]);
export type PlatformModelTestRequest=z.infer<typeof PlatformModelTestRequest>;
export type PlatformModelTestCapability=z.infer<typeof PlatformModelTestCapability>;
const Asset=z.object({url:z.string().max(2000).refine(value=>{if(/[\\\u0000-\u0020]/.test(value))return false;if(value.startsWith("/")&&!value.startsWith("//"))return true;try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password;}catch{return false;}}),mimeType:z.string().max(100)}).strict();
export const PlatformModelTestResult=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("text"),text:z.string().max(65536)}).strict(),
 z.object({kind:z.literal("image"),assets:z.array(Asset).min(1).max(4)}).strict(),
 z.object({kind:z.literal("audio"),asset:Asset,durationMs:z.number().int().nonnegative().nullable()}).strict(),
 z.object({kind:z.literal("embedding"),vectorCount:z.number().int().min(1).max(8),dimensions:z.number().int().positive().max(16384),preview:z.array(z.number().finite()).max(16)}).strict(),
 z.object({kind:z.literal("rerank"),results:z.array(z.object({index:z.number().int().nonnegative().max(19),score:z.number().finite()}).strict()).max(20)}).strict(),
]);
export type PlatformModelTestResult=z.infer<typeof PlatformModelTestResult>;
export const PlatformModelTestRecord=z.object({testId:z.string().uuid(),orgId:z.string(),modelId:z.string(),capability:PlatformModelTestCapability,
 state:z.enum(["queued","dispatching","succeeded","failed","cancelled","unknown"]),settlementState:z.enum(["pending","settled","held"]),result:PlatformModelTestResult.nullable(),
 failureReason:z.enum(["adapter-unavailable","admission-refused","dispatch-cancelled","provider-unconfirmed","dispatch-in-progress","accounting-unavailable"]).nullable(),
 usage:z.object({tokens:Micros.nullable(),inputTokens:Micros.nullable().optional(),outputTokens:Micros.nullable().optional(),nativeUnit:z.enum(NATIVE_UNITS).nullable(),nativeQuantity:Micros.nullable(),costMicros:Micros.nullable(),currency:z.string().max(10).nullable(),priceVersion:z.string().max(200).nullable()}).strict().nullable(),
}).strict();
export type PlatformModelTestRecord=z.infer<typeof PlatformModelTestRecord>;
export const PlatformModelTestCandidate=z.object({modelId:z.string(),displayName:z.string(),capability:PlatformModelTestCapability,
 available:z.boolean(),reason:z.string().max(200).nullable(),modelProvider:z.string().nullable(),runtimeModelId:z.string().nullable(),currency:z.string().nullable(),
 maximumOutputTokens:z.number().int().positive().nullable(),nativeUnit:z.enum(NATIVE_UNITS).nullable(),maximumQuantity:Micros.nullable(),
}).strict();
export const operations={
 candidates:{method:"GET",path:"/platform/model-tests/candidates",in:z.object({orgId:z.string().min(1)}).strict(),out:z.array(PlatformModelTestCandidate)},
 start:{method:"POST",path:"/platform/model-tests",in:PlatformModelTestRequest,out:PlatformModelTestRecord},
 get:{method:"GET",path:"/platform/model-tests/:testId",in:z.object({testId:z.string().uuid(),orgId:z.string().min(1)}).strict(),out:PlatformModelTestRecord},
 cancel:{method:"POST",path:"/platform/model-tests/:testId/cancel",in:z.object({orgId:z.string().min(1)}).strict(),out:PlatformModelTestRecord},
} as const;
export type PlatformModelTestCandidate=z.infer<typeof PlatformModelTestCandidate>;
