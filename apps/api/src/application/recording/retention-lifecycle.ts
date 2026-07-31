/**
 * F78 — 保留期的四个用例：解析 · 固化 · 到期删除 · 查询。
 *
 * 对应契约 `recording.operations` 的 `resolveRetention` / `freezeMaterialExpiry` /
 * `runExpiryDeletion` / `getMaterialRetention`。
 *
 * ## 三条不许松的
 *
 * 1. **固化后不追溯**（I-31）。`freezeMaterialExpiry` 之后，参数怎么改都不影响已落库材料。
 *    形状上的保证：`getMaterialRetention` **不读参数存储**，它只读材料上固化的那份。
 *    真要保证，光靠「没写读参数的代码」不够 —— 反向断言在测试里：改参数、重读、三字段不变。
 * 2. **先逻辑失效再物理删除**（uc-5-4 R3-4 / E7 / I-34）。删除失败时材料**保持不可读**、
 *    **不产出删除证明**，并且整轮判失败（I-11「部分成功一律不得报成功」）。
 * 3. **禁止用于训练全生命周期恒成立**（I-37）。`trainingProhibited` 的类型是字面量 `true`，
 *    本文件里也没有任何写它的路径 —— 唯一赋值点在 `domain/recording/retention.freezeExpiry`。
 */
import {
  classifyExpiry,
  freezeExpiry,
  resolveDeletionGraceDays,
  resolveMaterialRetention,
  type MaterialRetentionRecord,
  type RecordingErrorCode,
  type RetentionResolution,
} from "../../domain/recording/retention";
import type { DeletionCertificate, RetentionDeps } from "./retention-ports";

export type Fail<E extends RecordingErrorCode = RecordingErrorCode> = {
  readonly ok: false;
  readonly reason: E;
};
export type Result<T> = ({ readonly ok: true } & T) | Fail;

const fail = (reason: RecordingErrorCode): Fail => ({ ok: false, reason });

/* ── 一、解析（`resolveRetention`）──────────────────────────────────── */

export interface ResolveRetentionInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly resolvedAt: string;
}

/**
 * 解析生效的材料保留期：项目级覆盖值 → 组织默认值。
 *
 * ⚠ 这个用例**从头到尾没有一个数字**。它读端口、交给领域函数挑一级、把结果原样返回。
 *   「读参数返回默认值」的验收就落在这条链上：默认值是内核配的，本模块只是把它搬过来。
 */
export async function resolveRetention(
  deps: RetentionDeps,
  input: ResolveRetentionInput,
): Promise<Result<{ retention: RetentionResolution }>> {
  const params = await deps.params.parameters({ orgId: input.orgId, projectId: input.projectId });
  const resolved = resolveMaterialRetention(params, input.resolvedAt);
  if (!resolved.ok) return fail(resolved.reason);
  return { ok: true, retention: resolved.value };
}

/* ── 二、固化（`freezeMaterialExpiry`）──────────────────────────────── */

export interface FreezeMaterialExpiryInput {
  readonly materialId: string;
  /** 落库时刻。到期时间 = 它 + 生效保留期。 */
  readonly storedAt: string;
  readonly retentionResolution: RetentionResolution;
  /** 该材料是否被不可变快照引用（C_REC_2 的枚举依据，不是裁决）。 */
  readonly snapshotReferenced?: boolean;
}

export interface FreezeMaterialExpiryOutput {
  readonly materialId: string;
  readonly expiresAt: string;
  readonly resolvedDays: number;
  readonly resolvedFrom: MaterialRetentionRecord["resolvedFrom"];
  /** 契约里是 `z.literal(true)`。这里也是字面量类型，不是 `boolean`。 */
  readonly trainingProhibited: true;
}

export async function freezeMaterialExpiry(
  deps: RetentionDeps,
  input: FreezeMaterialExpiryInput,
): Promise<Result<FreezeMaterialExpiryOutput>> {
  // 固化是一次性的。二次固化正是「事后改参数追溯已落库材料」的入口，所以它是错误而非幂等。
  const existing = await deps.materials.material(input.materialId);
  if (existing !== undefined) return fail("EXPIRY_ALREADY_FROZEN");

  const frozen = freezeExpiry({
    materialId: input.materialId,
    storedAt: input.storedAt,
    resolution: input.retentionResolution,
    snapshotReferenced: input.snapshotReferenced ?? false,
  });
  if (!frozen.ok) return fail(frozen.reason);

  await deps.materials.insertFrozen(frozen.value);

  return {
    ok: true,
    materialId: frozen.value.materialId,
    expiresAt: frozen.value.expiresAt,
    resolvedDays: frozen.value.resolvedDays,
    resolvedFrom: frozen.value.resolvedFrom,
    trainingProhibited: frozen.value.trainingProhibited,
  };
}

/* ── 三、到期删除（`runExpiryDeletion`）─────────────────────────────── */

export interface RunExpiryDeletionInput {
  readonly asOf: string;
  /** 宽限期是组织级参数，所以扫描任务也要一个组织/项目上下文来读它。 */
  readonly orgId: string;
  readonly projectId: string;
}

export interface ExpiryDeletionReport {
  /** 本轮由「可读」转为「不可读」的材料（退出检索、报告段落标「证据已撤回」）。 */
  readonly logicallyDisabled: readonly string[];
  /** 本轮真的删到了文件层的材料。 */
  readonly physicallyDeleted: readonly string[];
  readonly certificates: readonly { readonly materialId: string; readonly certificateId: string }[];
  /**
   * 宽限期已满、但**被不可变快照引用**的材料。
   * ⚠ `KNOWN_CONTRACT_GAPS.C_REC_2` 未裁 —— 它们既没被删，也没被当作「没事」。
   *   这一栏存在的意义就是让这批材料在每一轮任务里**继续冒头**，而不是沉默地留着。
   */
  readonly deferredPendingRuling: readonly string[];
  /** 物理删除失败的材料。它们**保持不可读**、**没有证明**（E7 / I-34）。 */
  readonly failed: readonly { readonly materialId: string; readonly error: string }[];
}

export type RunExpiryDeletionResult =
  | ({ readonly ok: true } & ExpiryDeletionReport)
  | ({ readonly ok: false; readonly reason: RecordingErrorCode } & Partial<ExpiryDeletionReport>);

/**
 * 到期删除任务。
 *
 * ⚠ 相位判定全部委托给 `classifyExpiry` —— 本文件不重写一遍「到期了没」。
 *   把判据写两份正是本仓漂移过五次的形状。
 */
export async function runExpiryDeletion(
  deps: RetentionDeps,
  input: RunExpiryDeletionInput,
): Promise<RunExpiryDeletionResult> {
  const params = await deps.params.parameters({ orgId: input.orgId, projectId: input.projectId });
  const grace = resolveDeletionGraceDays(params);
  if (!grace.ok) return { ok: false, reason: grace.reason };

  const logicallyDisabled: string[] = [];
  const physicallyDeleted: string[] = [];
  const certificates: { materialId: string; certificateId: string }[] = [];
  const deferredPendingRuling: string[] = [];
  const failed: { materialId: string; error: string }[] = [];

  for (const material of await deps.materials.notYetDeleted()) {
    const phase = classifyExpiry(material, input.asOf, grace.value);

    if (phase.phase === "disable") {
      // 第一步只做逻辑失效。**本轮不继续往下走** —— 「先逻辑失效」是顺序约束，
      // 一轮里既失效又删除会让宽限期形同虚设。
      await deps.materials.markLogicallyDisabled(material.materialId, input.asOf);
      logicallyDisabled.push(material.materialId);
      continue;
    }

    if (phase.phase === "deferred-unresolved") {
      deferredPendingRuling.push(material.materialId);
      continue;
    }

    if (phase.phase !== "delete") continue;

    const purged = await deps.objects.purge(material.materialId);
    if (!purged.ok) {
      // E7：不改状态（材料**依然**是逻辑失效的、不可读的），不发证明，进失败清单。
      failed.push({ materialId: material.materialId, error: purged.error });
      continue;
    }

    // I-34：证明在物理删除**成功之后**才产生。顺序不是风格问题，是这条不变量本身。
    const certificate = await deps.certificates.issue({
      materialId: material.materialId,
      deletedAt: input.asOf,
      deletedObjectKeys: purged.deletedObjectKeys,
      resolvedDays: material.resolvedDays,
      resolvedFrom: material.resolvedFrom,
      expiresAt: material.expiresAt,
    });
    await deps.materials.markPhysicallyDeleted({
      materialId: material.materialId,
      at: input.asOf,
      certificateId: certificate.certificateId,
    });
    physicallyDeleted.push(material.materialId);
    certificates.push({
      materialId: material.materialId,
      certificateId: certificate.certificateId,
    });
  }

  const report: ExpiryDeletionReport = {
    logicallyDisabled,
    physicallyDeleted,
    certificates,
    deferredPendingRuling,
    failed,
  };

  // I-11 / I-34：有任何一份没删掉，整轮就不是成功。已删的保留、已发的证明保留、可重试。
  if (failed.length > 0) return { ok: false, reason: "DELETION_TASK_FAILED", ...report };
  return { ok: true, ...report };
}

/* ── 四、查询（`getMaterialRetention`）──────────────────────────────── */

export interface MaterialRetentionView {
  readonly expiresAt: string;
  readonly resolvedDays: number;
  readonly resolvedFrom: MaterialRetentionRecord["resolvedFrom"];
  readonly trainingProhibited: boolean;
  readonly deletionCertificateId: string | null;
  /** AC1：「能看到每份转写的保留期与删除时间」—— 逻辑失效时刻也要看得见。 */
  readonly logicallyDisabledAt: string | null;
  readonly physicallyDeletedAt: string | null;
}

/**
 * 查询某份材料的保留期。
 *
 * ⚠ **这里故意不读 `deps.params`。** 读了就等于让展示值跟着当前参数走，I-31 当场破。
 *   一切都来自材料上固化的那份。
 */
export async function getMaterialRetention(
  deps: RetentionDeps,
  materialId: string,
): Promise<Result<{ retention: MaterialRetentionView }>> {
  const material = await deps.materials.material(materialId);
  if (material === undefined) return fail("MATERIAL_NOT_FOUND");
  return {
    ok: true,
    retention: {
      expiresAt: material.expiresAt,
      resolvedDays: material.resolvedDays,
      resolvedFrom: material.resolvedFrom,
      trainingProhibited: material.trainingProhibited,
      deletionCertificateId: material.deletionCertificateId,
      logicallyDisabledAt: material.logicallyDisabledAt,
      physicallyDeletedAt: material.physicallyDeletedAt,
    },
  };
}

/** 删除证明的检索出口（AC4「可检索」）。 */
export async function findDeletionCertificate(
  deps: RetentionDeps,
  materialId: string,
): Promise<DeletionCertificate | undefined> {
  return deps.certificates.byMaterial(materialId);
}
