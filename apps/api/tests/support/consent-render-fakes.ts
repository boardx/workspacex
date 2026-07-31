/**
 * F79 端口的内存实现。
 *
 * ⚠ 与 F78 `retention-fakes.ts` 同一纪律：**fake 不是 stub**——模板、联系信息、
 *   快照都真的存起来。「固化后改内容不追溯」只有在重新读一次存储时才谈得上被证明。
 */
import type {
  ConsentComplianceContactStore,
  ConsentRenderDeps,
  ConsentSnapshotStore,
  ConsentSubmissionStore,
  ConsentTemplateStore,
} from "../../src/application/recording/consent-render-ports";
import type { ConsentRenderInstance } from "../../src/domain/recording/consent-render";
import type { RetentionDeps, RetentionParameters } from "../../src/application/recording/retention-ports";
import { FakeCertificates, FakeMaterials, FakeObjects, FakeRetentionParams } from "./retention-fakes";

export class FakeConsentTemplates implements ConsentTemplateStore {
  private readonly rows = new Map<string, string>();

  constructor(seed?: Record<string, string>) {
    for (const [id, text] of Object.entries(seed ?? {})) this.rows.set(id, text);
  }

  async template(templateId: string): Promise<string | undefined> {
    return this.rows.get(templateId);
  }

  set(templateId: string, text: string): void {
    this.rows.set(templateId, text);
  }
}

export type ComplianceContact = {
  readonly dataController: string | null;
  readonly contactName: string | null;
  readonly complianceEmail: string | null;
};

export class FakeComplianceContacts implements ConsentComplianceContactStore {
  private readonly rows = new Map<string, ComplianceContact>();

  constructor(private readonly fallback: ComplianceContact) {}

  async contact(input: { readonly projectId: string }): Promise<ComplianceContact> {
    return this.rows.get(input.projectId) ?? this.fallback;
  }

  /** 项目级覆盖——用来断言「改配置后新渲染立刻变化」。 */
  set(projectId: string, contact: Partial<ComplianceContact>): void {
    const current = this.rows.get(projectId) ?? this.fallback;
    this.rows.set(projectId, { ...current, ...contact });
  }
}

export class FakeConsentSnapshots implements ConsentSnapshotStore {
  private readonly rows = new Map<string, ConsentRenderInstance>();

  async instance(consentId: string): Promise<ConsentRenderInstance | undefined> {
    return this.rows.get(consentId);
  }

  async insert(instance: ConsentRenderInstance): Promise<void> {
    this.rows.set(instance.consentId, instance);
  }

  /** 测试直读，绕过用例层，用来断言「存储里到底变成了什么」。 */
  peek(consentId: string): ConsentRenderInstance | undefined {
    return this.rows.get(consentId);
  }
}

export class FakeConsentSubmissions implements ConsentSubmissionStore {
  private readonly submitted = new Set<string>();

  async isSubmitted(consentId: string): Promise<boolean> {
    return this.submitted.has(consentId);
  }

  markSubmitted(consentId: string): void {
    this.submitted.add(consentId);
  }
}

export interface ConsentRenderHarness extends ConsentRenderDeps {
  readonly retention: RetentionDeps & { readonly params: FakeRetentionParams };
  readonly templates: FakeConsentTemplates;
  readonly contacts: FakeComplianceContacts;
  readonly snapshots: FakeConsentSnapshots;
  readonly submissions: FakeConsentSubmissions;
}

/**
 * 组一套依赖。⚠ 保留期参数**必须由调用方给全**（同 F78 纪律），
 *   合规联系信息默认给全（三字段非空），测试需要「缺失」场景时显式 `contacts.set(...)`。
 */
export function consentRenderHarness(input: {
  readonly retentionParams: RetentionParameters;
  readonly contact?: Partial<ComplianceContact>;
  readonly templates?: Record<string, string>;
}): ConsentRenderHarness {
  return {
    retention: {
      params: new FakeRetentionParams(input.retentionParams),
      materials: new FakeMaterials(),
      objects: new FakeObjects(),
      certificates: new FakeCertificates(),
    },
    templates: new FakeConsentTemplates(input.templates),
    contacts: new FakeComplianceContacts({
      dataController: "远洋咨询",
      contactName: "林可",
      complianceEmail: "compliance@example.com",
      ...input.contact,
    }),
    snapshots: new FakeConsentSnapshots(),
    submissions: new FakeConsentSubmissions(),
  };
}
