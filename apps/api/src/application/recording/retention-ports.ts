/**
 * F78 — 保留期与到期删除所需的端口。
 *
 * ⚠ 与 F69 同一个判断：**本 feature 不落 PostgreSQL 实现**。
 *   `application/recording/ports.ts` 已经把理由写清楚了（F69 的 `segments` / `tracks` 由
 *   F70–F73 定形，现在造表等于替它们猜 schema）。保留期这边是同一个形状再加一条：
 *   参数的**权威存储在 00-core / 17-gov 的留存策略内核**（`domain.md` X-4），本束是消费方；
 *   在内核落地之前建一张 `retention_parameters` 表，就是给「保留期」造第二个事实源 ——
 *   而本 feature 的全部意义正是「保留期只有一处」。
 *
 *   ⇒ 本文件定义**问题的形状**，`tests/support/retention-fakes.ts` 给出内存实现，
 *     结构性断言跑在它上面（feature notes 逐字：「改写为结构性断言」）。
 *
 * ⚠ `RetentionParameterStore` **不返回默认值**。它返回「配了什么」，`null` 就是没配。
 *   把默认值塞进这个端口的实现里，等于把常量从 `domain` 挪到 `infrastructure` —— I-32 照样破。
 */
import type {
  MaterialRetentionRecord,
  RetentionParameters,
} from "../../domain/recording/retention";

export interface RetentionParameterStore {
  /**
   * 读取该项目/组织当前的留存参数。
   * ⚠ 实现方**不得**在这里兜底：没配就是 `null`，由用例判 `RETENTION_POLICY_MISSING`。
   */
  parameters(input: {
    readonly orgId: string;
    readonly projectId: string;
  }): Promise<RetentionParameters>;
}

export interface MaterialRetentionStore {
  material(materialId: string): Promise<MaterialRetentionRecord | undefined>;
  /** 固化。⚠ 已固化的材料再次固化必须失败（`EXPIRY_ALREADY_FROZEN`），由用例先查再写。 */
  insertFrozen(record: MaterialRetentionRecord): Promise<void>;
  markLogicallyDisabled(materialId: string, at: string): Promise<void>;
  markPhysicallyDeleted(input: {
    readonly materialId: string;
    readonly at: string;
    readonly certificateId: string;
  }): Promise<void>;
  /** 到期删除任务的扫描面：所有尚未物理删除的材料。相位由领域函数判，不在 SQL 里判第二遍。 */
  notYetDeleted(): Promise<readonly MaterialRetentionRecord[]>;
}

/**
 * 文件层（I-35，跨束 22-files）。
 *
 * ⚠ 「只删数据库行而文件仍可下载 = 缺陷」是 uc-5-4 R10 的原话。所以物理删除走这个端口，
 *   并且它**返回被删掉的对象键**：删除证明里那句「真的删了」必须有可核对的内容，
 *   而不是一个布尔。
 */
export interface MaterialObjectStore {
  purge(materialId: string): Promise<
    | { readonly ok: true; readonly deletedObjectKeys: readonly string[] }
    | { readonly ok: false; readonly error: string }
  >;
}

/**
 * 删除证明。
 *
 * ⚠ **格式与签名形态是 D-3（缺合规输入）**，本束不发明。这里只放「能证明的事实」：
 *   删了哪份材料、什么时候、删掉了哪些对象键、当时生效的保留期是多少天取自哪一级。
 *   I-34 要断言的是「有 / 无」与「只在物理删除成功后才有」，这两条不依赖格式。
 */
export interface DeletionCertificate {
  readonly certificateId: string;
  readonly materialId: string;
  readonly deletedAt: string;
  readonly deletedObjectKeys: readonly string[];
  readonly resolvedDays: number;
  readonly resolvedFrom: MaterialRetentionRecord["resolvedFrom"];
  /** 固化的到期时间，进证明是为了让「为什么这时候删」可核对。 */
  readonly expiresAt: string;
}

export interface DeletionCertificateStore {
  issue(input: Omit<DeletionCertificate, "certificateId">): Promise<DeletionCertificate>;
  /** 「可检索」是 AC4 的字面要求：证明必须能按材料查回来。 */
  byMaterial(materialId: string): Promise<DeletionCertificate | undefined>;
  byCertificateId(certificateId: string): Promise<DeletionCertificate | undefined>;
}

export interface RetentionDeps {
  readonly params: RetentionParameterStore;
  readonly materials: MaterialRetentionStore;
  readonly objects: MaterialObjectStore;
  readonly certificates: DeletionCertificateStore;
}

export type { MaterialRetentionRecord, RetentionParameters };
