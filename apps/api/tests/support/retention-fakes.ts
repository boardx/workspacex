/**
 * F78 端口的内存实现。
 *
 * ⚠ 这些是 **fake 不是 stub**：材料真的存起来、真的被改状态，删除证明真的按 materialId 建索引。
 *   「固化后改参数不追溯」这条只有在**重新读一次存储**时才谈得上被证明 —— 如果读回来的是
 *   用例刚刚返回的那个对象，断言就是在验证自己刚说过的话。
 *
 * ⚠ **所有天数都由测试供给**，和 F69 的 `someRetention` 同一个纪律：被测模块不拥有任何一个数。
 */
import type {
  DeletionCertificate,
  DeletionCertificateStore,
  MaterialObjectStore,
  MaterialRetentionStore,
  RetentionDeps,
  RetentionParameterStore,
} from "../../src/application/recording/retention-ports";
import type {
  MaterialRetentionRecord,
  RetentionParameters,
} from "../../src/domain/recording/retention";

/** 参数存储。可写 —— 「事后改参数」正是 I-31 反向断言要做的动作。 */
export class FakeRetentionParams implements RetentionParameterStore {
  constructor(private current: RetentionParameters) {}

  async parameters(): Promise<RetentionParameters> {
    return this.current;
  }

  /** 事后改参数。已固化的材料**必须**不受影响。 */
  set(next: Partial<RetentionParameters>): void {
    this.current = { ...this.current, ...next };
  }
}

export class FakeMaterials implements MaterialRetentionStore {
  private readonly rows = new Map<string, MaterialRetentionRecord>();

  async material(materialId: string): Promise<MaterialRetentionRecord | undefined> {
    return this.rows.get(materialId);
  }

  async insertFrozen(record: MaterialRetentionRecord): Promise<void> {
    this.rows.set(record.materialId, record);
  }

  async markLogicallyDisabled(materialId: string, at: string): Promise<void> {
    const row = this.rows.get(materialId);
    if (row === undefined) throw new Error(`no material ${materialId}`);
    this.rows.set(materialId, { ...row, logicallyDisabledAt: at });
  }

  async markPhysicallyDeleted(input: {
    materialId: string;
    at: string;
    certificateId: string;
  }): Promise<void> {
    const row = this.rows.get(input.materialId);
    if (row === undefined) throw new Error(`no material ${input.materialId}`);
    this.rows.set(input.materialId, {
      ...row,
      physicallyDeletedAt: input.at,
      deletionCertificateId: input.certificateId,
    });
  }

  async notYetDeleted(): Promise<readonly MaterialRetentionRecord[]> {
    return [...this.rows.values()].filter((r) => r.physicallyDeletedAt === null);
  }

  /** 测试直读，用来断言「存储里到底变成了什么」，而不是「用例说它变成了什么」。 */
  peek(materialId: string): MaterialRetentionRecord | undefined {
    return this.rows.get(materialId);
  }
}

/**
 * 文件层。默认每份材料四个对象键 —— 与 I-35 点名的四类一一对应
 * （音频 / `transcript.jsonl` / `notes.md` / 白板照片）。
 */
export class FakeObjects implements MaterialObjectStore {
  private readonly failing = new Set<string>();
  readonly purged = new Map<string, readonly string[]>();

  /** 让某份材料的物理删除失败（E7 / V7）。 */
  failFor(materialId: string): void {
    this.failing.add(materialId);
  }

  async purge(materialId: string): ReturnType<MaterialObjectStore["purge"]> {
    if (this.failing.has(materialId)) {
      return { ok: false, error: `object store unavailable for ${materialId}` };
    }
    const keys = [
      `${materialId}/audio.opus`,
      `${materialId}/transcript.jsonl`,
      `${materialId}/notes.md`,
      `${materialId}/whiteboard-01.jpg`,
    ];
    this.purged.set(materialId, keys);
    return { ok: true, deletedObjectKeys: keys };
  }

  /** 「文件是不是真的没了」的读端：删过的材料在这里查不到未删的键。 */
  stillReadable(materialId: string): boolean {
    return !this.purged.has(materialId);
  }
}

export class FakeCertificates implements DeletionCertificateStore {
  private readonly byId = new Map<string, DeletionCertificate>();
  private readonly byMaterialId = new Map<string, DeletionCertificate>();
  private seq = 0;

  async issue(input: Omit<DeletionCertificate, "certificateId">): Promise<DeletionCertificate> {
    this.seq += 1;
    const certificate: DeletionCertificate = { ...input, certificateId: `del-cert-${this.seq}` };
    this.byId.set(certificate.certificateId, certificate);
    this.byMaterialId.set(certificate.materialId, certificate);
    return certificate;
  }

  async byMaterial(materialId: string): Promise<DeletionCertificate | undefined> {
    return this.byMaterialId.get(materialId);
  }

  async byCertificateId(certificateId: string): Promise<DeletionCertificate | undefined> {
    return this.byId.get(certificateId);
  }

  get count(): number {
    return this.byId.size;
  }
}

export interface RetentionHarness extends RetentionDeps {
  readonly params: FakeRetentionParams;
  readonly materials: FakeMaterials;
  readonly objects: FakeObjects;
  readonly certificates: FakeCertificates;
}

/**
 * 组一套依赖。⚠ 参数**必须由调用方给全** —— 没有默认参数对象，
 * 否则「忘了配组织默认值」这件事会被 harness 悄悄补上，而那正是 E5 要抓的场景。
 */
export function retentionHarness(params: RetentionParameters): RetentionHarness {
  return {
    params: new FakeRetentionParams(params),
    materials: new FakeMaterials(),
    objects: new FakeObjects(),
    certificates: new FakeCertificates(),
  };
}
