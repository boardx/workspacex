/**
 * F78 — 材料保留期：参数解析 · 到期时间固化 · 到期删除的相位判定。
 *
 * ## 这个文件存在的唯一理由：**这里不许出现天数**
 *
 * O-01 给出了「材料保留期 180 天」。它是**留存策略内核（00-core / 17-gov）的配置初值**，
 * 不是本束的常量 —— `domain.md` X-4 写死了本束只是消费方，I-32 写死了「本束代码中不存在
 * 写死的保留天数常量」。所以本文件的每一个天数都来自 `RetentionParameters`，
 * 而 `RetentionParameters` 来自端口。**默认值已给出这件事不放松这一条**（uc-5-4 R7 逐字）。
 *
 * 这不是风格洁癖。本仓已经五次因为「同一事实声明在两处」而漂移；保留期尤其危险，
 * 因为它的第二份副本会出现在**受访者签过字的同意书**上（uc-5-4 R3-3 / AC2）——
 * 一旦系统执行的天数和告知的天数分叉，那是合规缺陷，不是文案问题。
 *
 * 机械落点是 `tests/rec/retention-param-resolution-no-hardcode.test.ts` 的静态检查：
 * 它扫本束全部源文件，天数黑名单（7/30/90/180/365/1095）**无豁免通道**。
 *
 * ## 本文件**不**决定的事（写下来，免得下一个人以为是遗漏）
 *
 * · **保留期的允许区间**（`domain.md` D-5 / thresholds `retentionMaterial.known: false`）。
 *   合规还没收窄区间，所以这里**不写上下界**。唯一的校验是把值交给契约里的
 *   `RetentionResolution` zod schema —— 「正整数」是**契约形状**，不是本模块发明的合规边界。
 * · **删除证明的字段与签名形态**（D-3，缺合规输入）。本文件只判定「该不该发」，
 *   `DeletionCertificate` 的内容由应用层按可证明的事实填，I-34 的「有/无」断言不受影响。
 * · **被不可变快照引用的材料到期时怎么办**（`KNOWN_CONTRACT_GAPS.C_REC_2`，**未裁**）。
 *   契约逐字写着「实现方**不得**自选一种当验收线」。所以 `classifyExpiry` 给它一个
 *   **独立相位** `deferred-unresolved`：既不物理删除（那是裁法 ②），也不悄悄当作正常保留
 *   （那是裁法 ①，且会让「180 天后消失」变成对受访者的假承诺）。它被**显式列出来等人裁**。
 */
import { recording as C } from "@repo/contracts";
import type { z } from "zod";

export type RetentionResolvedFrom = z.infer<typeof C.RetentionResolvedFrom>;
export type RecordingErrorCode = z.infer<typeof C.RecordingError>;

/**
 * 一天有多少毫秒。**这是单位换算，不是策略取值** —— 它不随组织、项目、合规裁决而变。
 *
 * 静态检查放行它靠的是行内标记 + 「参与运算的数都不在天数黑名单里」双条件；
 * 把 `180` 塞进这一行不会因为有标记就被放过。
 */
// [days-literal-ok:unit-conversion] 24h × 60min × 60s × 1000ms，与保留期策略无关
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 留存策略内核交给本束的参数。**三个字段都可以是 `null`，且 `null` 没有兜底。**
 *
 * `deletionGraceDays`（删除宽限期）同样是 O-01 五参数之一，同样是参数。
 * 把它写成常量 30 会让「到期后多久真删」这件对受访者的承诺脱离配置面 —— 与写死 180 同性质。
 */
export interface RetentionParameters {
  /** 项目级覆盖值。未配置 ⇒ `null`（**不是 0，也不是「等于组织默认」**）。 */
  readonly projectOverrideDays: number | null;
  /** 组织默认值。缺失 ⇒ `null` ⇒ `RETENTION_POLICY_MISSING`，不得用隐含常量兜底（I-33 / E5）。 */
  readonly orgDefaultDays: number | null;
  /** 删除宽限期。到期删除任务需要它；缺失同样是 `RETENTION_POLICY_MISSING`。 */
  readonly deletionGraceDays: number | null;
}

/**
 * 解析结果 —— **从契约推导，不在这里重写一遍**（`resolvedAt` 是解析时刻，不是落库时刻）。
 *
 * 第一版把这个类型手写成了 `Readonly<{ resolvedDays: number; … }>`，形状与契约一致，
 * 于是「看起来没问题」——`lint-contract-source.mjs` 当场判红。它是对的：
 * 形状一致的**副本**正是本仓漂移五次的那个形状，契约改了它不会跟着改。
 */
export type RetentionResolution = z.infer<typeof C.RetentionResolution>;

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: RecordingErrorCode };

const fail = (reason: RecordingErrorCode): DomainResult<never> => ({ ok: false, reason });

/**
 * 解析生效的材料保留期：**项目级覆盖值 → 组织默认值**（uc-5-4 R3-2）。
 *
 * ⚠ 这个函数里没有任何数字。它做的全部事情是**挑一级、记下挑了哪一级**。
 *   「读参数返回默认值」这句验收之所以能在没有常量的情况下断言，是因为
 *   测试对任意一组取值（7 / 90 / 180 / 365 / 4000…）跑同一张表：
 *   **写死任何一个数都会让其余全部行变红**。只断言 180 那一行是断言不出「读参数」的。
 */
export function resolveMaterialRetention(
  params: RetentionParameters,
  resolvedAt: string,
): DomainResult<RetentionResolution> {
  const picked =
    params.projectOverrideDays !== null
      ? ({ days: params.projectOverrideDays, from: "project" } as const)
      : params.orgDefaultDays !== null
        ? ({ days: params.orgDefaultDays, from: "org" } as const)
        : null;

  // I-33 / E5：两级都没有 ⇒ 拒绝。这里**没有 else 分支能回落到一个常量**。
  if (picked === null) return fail("RETENTION_POLICY_MISSING");

  const candidate = { resolvedDays: picked.days, resolvedFrom: picked.from, resolvedAt };

  // 校验判据来自契约本身（`z.number().int().positive()`），不是本模块另立的一套边界。
  // D-5 的「允许区间」仍待合规收窄 —— 收窄之后应该改契约，本文件不需要动。
  const parsed = C.RetentionResolution.safeParse(candidate);
  if (!parsed.success) return fail("RETENTION_VALUE_OUT_OF_RANGE");

  return { ok: true, value: candidate };
}

/** 删除宽限期的读取。与保留期同样的「无兜底」纪律，只是它没有项目级覆盖。 */
export function resolveDeletionGraceDays(params: RetentionParameters): DomainResult<number> {
  const days = params.deletionGraceDays;
  if (days === null) return fail("RETENTION_POLICY_MISSING");
  if (!Number.isInteger(days) || days < 0) return fail("RETENTION_VALUE_OUT_OF_RANGE");
  return { ok: true, value: days };
}

/**
 * 一份材料的保留期元数据 —— **落库时固化，此后不再随参数变动**（I-30 / I-31 / uc-5-4 R3-2）。
 *
 * `trainingProhibited` 的类型是字面量 `true` 而不是 `boolean`。这是 I-37 的编译期落点：
 * 「禁止用于训练」是与保留期**并列的独立开关**，不存在任何以保留期未到为由放宽它的路径 ——
 * 而 `trainingProhibited: false` 在本仓里**写不出来**，`tsc` 会拒绝。
 */
export type MaterialRetentionRecord = Readonly<{
  materialId: string;
  /** 落库时刻。到期时间由它 + 生效保留期算出，**算完就固化**。 */
  storedAt: string;
  /** 固化的到期时间。I-30：落库时刻已非空。 */
  expiresAt: string;
  /** 固化的解析结果：用了哪一级、当时是多少天（uc-5-4 R3-2「解析结果与解析依据一起写」）。 */
  resolvedDays: number;
  resolvedFrom: RetentionResolvedFrom;
  /** I-37：全生命周期恒 true，类型层面不可为 false。 */
  trainingProhibited: true;
  /** 逻辑失效时刻（退出检索、报告段落标「证据已撤回」）。未失效 ⇒ null。 */
  logicallyDisabledAt: string | null;
  /** 物理删除时刻。未删 ⇒ null。 */
  physicallyDeletedAt: string | null;
  /** 删除证明 id。**只在物理删除成功后非空**（I-34）。 */
  deletionCertificateId: string | null;
  /**
   * 是否被不可变快照（`artifact_versions`）引用。
   * ⚠ 这个字段的**存在**不代表本束选了 C_REC_2 的某一种裁法；它是让冲突可被枚举出来的手段。
   */
  snapshotReferenced: boolean;
}>;

/**
 * 固化到期时间。
 *
 * 输入是**落库时刻 + 当时的解析结果**，不是「现在的参数」——
 * 这正是 I-31 的形状：这个函数根本拿不到参数存储，所以它**没有能力**跟着参数变。
 * 反向断言见 `tests/rec/expiry-freeze-and-delete-cert.test.ts`：
 * 固化之后把参数改掉，重读材料，`expiresAt` / `resolvedDays` / `resolvedFrom` 三者不变。
 */
export function freezeExpiry(input: {
  readonly materialId: string;
  readonly storedAt: string;
  readonly resolution: RetentionResolution;
  readonly snapshotReferenced: boolean;
}): DomainResult<MaterialRetentionRecord> {
  const storedMs = Date.parse(input.storedAt);
  if (Number.isNaN(storedMs)) return fail("RETENTION_VALUE_OUT_OF_RANGE");

  const parsed = C.RetentionResolution.safeParse(input.resolution);
  if (!parsed.success) return fail("RETENTION_VALUE_OUT_OF_RANGE");

  const expiresAt = new Date(storedMs + input.resolution.resolvedDays * MS_PER_DAY).toISOString();

  return {
    ok: true,
    value: {
      materialId: input.materialId,
      storedAt: input.storedAt,
      expiresAt,
      resolvedDays: input.resolution.resolvedDays,
      resolvedFrom: input.resolution.resolvedFrom,
      trainingProhibited: true,
      logicallyDisabledAt: null,
      physicallyDeletedAt: null,
      deletionCertificateId: null,
      snapshotReferenced: input.snapshotReferenced,
    },
  };
}

/**
 * 到期删除的相位。**顺序是契约的一部分**：先逻辑失效，再（过宽限期）物理删除。
 *
 * · `live`                —— 未到期。
 * · `disable`             —— 已到期但还没逻辑失效 ⇒ 本轮要把它标成不可读。
 * · `awaiting-grace`      —— 已逻辑失效，宽限期未满 ⇒ 什么都不做，且**保持不可读**。
 * · `delete`              —— 宽限期已满 ⇒ 本轮物理删除并出证明。
 * · `deferred-unresolved` —— 宽限期已满，但材料被不可变快照引用 ⇒ **C_REC_2 未裁，不动**。
 *                            它**已经**逻辑失效（那一步两种裁法都成立），只是不物理删除。
 * · `done`                —— 已物理删除。
 */
export type ExpiryPhase =
  | { readonly phase: "live" }
  | { readonly phase: "disable" }
  | { readonly phase: "awaiting-grace"; readonly deletionDueAt: string }
  | { readonly phase: "delete" }
  | { readonly phase: "deferred-unresolved"; readonly gap: "C_REC_2" }
  | { readonly phase: "done" };

/** 宽限期到点的时刻 = 固化的到期时间 + 删除宽限期。同样只用参数，不用常量。 */
export function deletionDueAt(record: MaterialRetentionRecord, graceDays: number): string {
  return new Date(Date.parse(record.expiresAt) + graceDays * MS_PER_DAY).toISOString();
}

export function classifyExpiry(
  record: MaterialRetentionRecord,
  asOf: string,
  graceDays: number,
): ExpiryPhase {
  if (record.physicallyDeletedAt !== null) return { phase: "done" };

  const asOfMs = Date.parse(asOf);
  if (asOfMs < Date.parse(record.expiresAt)) return { phase: "live" };

  // I-34 / E7 的形状：逻辑失效**先于**一切，且失败重试时它不会被退回。
  if (record.logicallyDisabledAt === null) return { phase: "disable" };

  const dueAt = deletionDueAt(record, graceDays);
  if (asOfMs < Date.parse(dueAt)) return { phase: "awaiting-grace", deletionDueAt: dueAt };

  if (record.snapshotReferenced) return { phase: "deferred-unresolved", gap: "C_REC_2" };
  return { phase: "delete" };
}
