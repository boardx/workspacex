/**
 * #1493（UC-7.3 第一块）—— 画布实例源码链的端口。
 *
 * `instantiateForSegment` / `getSource` / `updateSource` 三个用例对存储层的全部要求。
 * 定义在 application，由 `infrastructure/canvas/pg-canvas-instance-repository.ts` 实现，
 * 与 `template-ports.ts` 并列而不是塞进去：那份文件头明写它服务的是模板注册表，
 * 实例是另一张表、另一段生命周期。
 */
import type { OrgId } from "../../domain/org-id";

export const CANVAS_INSTANCE_REPOSITORY = Symbol("CANVAS_INSTANCE_REPOSITORY");

/** 一行已实例化的画布（契约 `instantiateForSegment.out.instances[]` 的存储投影）。 */
export interface CanvasInstanceRow {
  readonly instanceId: string;
  readonly groupId: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  /**
   * 初始版本行（v1）的 id。契约把它叫 `sourceArtifactId`，但本仓通用 artifact 系统
   * 并未接入这条链（全仓 grep 证实该字段从未指向 artifacts 表的行）——这是**命名遗留**，
   * 值是 `canvas_instance_versions` 里 v1 那一行的主键，不假装接了 artifact 束。
   */
  readonly sourceArtifactId: string;
}

/**
 * 实例头 + 归属，`getSource`/`updateSource` 的判定输入；第二块（render/export）
 * 追加 `templateKey`/`templateVersion`——冻结的模板身份是分区投影与几何归区的寻址键，
 * 仍然只是路由事实，不含内容（`instance-repo-guard.test.ts` 断言 findInstance 无 markdown）。
 */
export interface CanvasInstanceFacts {
  readonly instanceId: string;
  readonly workshopId: string;
  readonly groupId: string;
  readonly headVersion: number;
  readonly templateKey: string;
  readonly templateVersion: number;
}

/** 一行版本（`getSource.out` 的存储投影）。 */
export interface CanvasInstanceVersionRow {
  readonly versionId: string;
  readonly version: number;
  readonly markdown: string;
  readonly contentHash: string;
}

/**
 * 模板版本行的内容投影。第一块只用 name/order 合成初始 markdown；第二块的
 * `renderCanvas` 需要完整 `SectionDef` 形状（sectionId/required/capacity）——
 * `canvas_templates.sections` jsonb 本来就按契约 `SectionDef` 写入（createTemplate
 * 的 `z.array(SectionDef)`），这里只是不再丢字段，不发明第二种形状。
 */
export interface TemplateSectionFacts {
  readonly sectionId: string;
  readonly name: string;
  readonly order: number;
  readonly required: boolean;
  readonly capacity: number | null;
}

export interface TemplateContentFacts {
  readonly displayName: string;
  readonly sections: readonly TemplateSectionFacts[];
}

export interface CreateInstanceCmd {
  readonly instanceId: string;
  readonly groupId: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly initialVersionId: string;
  readonly initialMarkdown: string;
  readonly contentHash: string;
}

export interface AppendVersionCmd {
  readonly orgId: OrgId;
  readonly instanceId: string;
  /** 乐观并发：与当前 `head_version` 不等 ⇒ 零行 ⇒ `VERSION_CHANGED`。 */
  readonly expectedHeadVersion: number;
  readonly versionId: string;
  readonly markdown: string;
  readonly contentHash: string;
  readonly createdBy: string;
}

export interface CanvasInstanceRepository {
  /** 模板展示名 + 分区（初始 markdown 的原料）。`null` = 模板版本不存在。 */
  findTemplateContent(
    orgId: OrgId,
    key: string,
    version: number,
  ): Promise<TemplateContentFacts | null>;

  /** 幂等重放的读取面：同 (环节, 幂等键) 已实例化出的那一批，稳定排序。 */
  listByIdempotencyKey(
    orgId: OrgId,
    agendaSegmentId: string,
    idempotencyKey: string,
  ): Promise<readonly CanvasInstanceRow[]>;

  /**
   * 一个事务里写入一批实例头 + 各自的 v1 版本行。
   * 并发重试撞 `canvas_instances_idempotency_uniq` 时返回 `"conflict"`，
   * 调用方回读既有那一批——判定在数据库，不先查后写。
   */
  createInstances(cmd: {
    readonly orgId: OrgId;
    readonly agendaSegmentId: string;
    readonly workshopId: string;
    readonly idempotencyKey: string;
    readonly createdBy: string;
    readonly instances: readonly CreateInstanceCmd[];
  }): Promise<"created" | "conflict">;

  /** 实例头。RLS 下别组织的实例查不到 ⇒ `null` 同时覆盖「不存在」与「不是你的组织」。 */
  findInstance(orgId: OrgId, instanceId: string): Promise<CanvasInstanceFacts | null>;

  /** 读一版源码；`versionId` 省略 = head。`null` = 版本不存在。 */
  findVersion(
    orgId: OrgId,
    instanceId: string,
    versionId: string | undefined,
  ): Promise<CanvasInstanceVersionRow | null>;

  /**
   * 追加新版本 + 推进 head 指针，**同一条 CTE 语句**（判定与写入不分离，
   * 同 `pg-canvas-template-repository.ts` `create()` 的纪律）。
   * 零行 ⇒ `expectedHeadVersion` 已不是当前 head ⇒ 调用方抛 `VERSION_CHANGED`。
   */
  appendVersion(cmd: AppendVersionCmd): Promise<CanvasInstanceVersionRow | null>;
}
