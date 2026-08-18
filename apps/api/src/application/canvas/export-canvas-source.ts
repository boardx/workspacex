/**
 * `exportSource`（#1493 / UC-7.3 第二块）—— 画布对象 → Markdown，**几何归区在此发生**。
 *
 * ## I-9 / D-08 ②：输出里没有坐标——结构性成立，不靠自觉
 *
 * `stickyPositions` 只进入 `assignStickyToBox` 的判定，判定得出「归哪个 `##` 段落」后
 * 坐标即被丢弃；重写只做两种行操作：删除被移动便签的原行、在目标段落末尾追加
 * `- <原文>`。没有任何代码路径把数字坐标序列化进文本——e2e 用坐标数字模式反证。
 *
 * ## 不落库：out 是 markdown + assignments，没有版本推进
 *
 * 契约 `exportSource.out` 里没有 versionId/contentHash——导出是读 + 纯计算，写回是
 * 调用方拿着结果再走 `updateSource`（乐观并发也由那一步把关；本操作因此实际不会抛
 * `VERSION_CHANGED`，该码在 err 闭集里是为将来「基于过期画布导出」的判定留的口，
 * 本块没有那个判定的输入）。作用于 head 版本。
 *
 * ## 鉴权：组内动作（err 闭集里是 NOT_IN_GROUP，不是 NO_PROJECT_ROLE）
 *
 * 导出即将变成写回的前置一步，契约把它归入组内动作——判定与 `updateSource` 同一条：
 * 调用者的项目成员行 `group_id` 必须等于实例的 `group_id`，非成员与别组成员同一个出口
 * （update-canvas-source.ts 文件头的论证逐字适用）。判定先于 `findVersion`
 * （instance-repo-guard.test.ts 钉住顺序）。
 *
 * ## 分区框几何从哪来
 *
 * 实例冻结的 `templateKey` 在 `@repo/fabric-markdown` 的 19 模板注册表里查
 * `TemplateSpec.sections`（中心 x,y + w,h），按**分区名**与 markdown 的 `## 段落`
 * 对账——名字匹配正是引擎 `buildTemplateModel` 自己的约定（`sections.get(sec.name)`）。
 * 判定语义（框内命中 / 最近框兜底）见 `domain/canvas/sticky-geometry.ts`。
 * 组织自建模板引擎里没有几何 ⇒ 没有框可判 ⇒ 每张便签保持原分区、`nearestFallback:false`
 * ——几何归区对无几何的模板是恒等映射，不是错误（err 闭集里也没有码给它）。
 */
import { getTemplate } from "@repo/fabric-markdown/templates";
import {
  assignStickyToBox,
  type SectionBox,
} from "../../domain/canvas/sticky-geometry";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError } from "./errors";
import type { CanvasInstanceRepository, TemplateSectionFacts } from "./instance-ports";
import {
  derivedSectionId,
  projectSource,
  type SourceProjection,
} from "./source-projection";

export interface ExportCanvasSourceDeps {
  readonly identity: IdentityRepository;
  readonly instances: CanvasInstanceRepository;
}

export interface StickyPositionInput {
  readonly stickyId: string;
  readonly x: number;
  readonly y: number;
}

export interface ExportCanvasSourceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly instanceId: string;
  readonly stickyPositions: readonly StickyPositionInput[];
}

export interface ExportAssignment {
  readonly stickyId: string;
  readonly sectionId: string;
  readonly nearestFallback: boolean;
}

export interface ExportCanvasSourceOutput {
  readonly markdown: string;
  readonly assignments: readonly ExportAssignment[];
}

/**
 * 导出的纯投影（head markdown + 冻结分区 + 坐标 → 契约 out 形状）。
 * 单独导出：I-9 / 归区边界的单测直接打它，e2e 打整条 HTTP 链，两边是同一个函数。
 */
export function projectExportFace(
  markdown: string,
  templateKey: string,
  templateSections: readonly TemplateSectionFacts[],
  stickyPositions: readonly StickyPositionInput[],
): ExportCanvasSourceOutput {
  const projection = projectSource(markdown);

  // sectionId 解析规则与 renderCanvas 完全一致（冻结分区按名，多出的标题走派生 id）。
  const sectionIdByName = new Map<string, string>(
    templateSections.map((s) => [s.name, s.sectionId]),
  );
  for (const sec of projection.sections) {
    if (!sectionIdByName.has(sec.name)) {
      sectionIdByName.set(sec.name, derivedSectionId(sec.name));
    }
  }

  // 分区框：markdown 里实际存在的 `## 段落` ∩ 引擎模板的同名几何（见文件头）。
  const spec = getTemplate(templateKey);
  const seen = new Set<string>();
  const boxes: SectionBox[] = [];
  if (spec) {
    for (const sec of projection.sections) {
      if (seen.has(sec.name)) continue; // 重名标题按引擎语义合并为一个分区
      const g = spec.sections.find((s) => s.name === sec.name);
      if (g) {
        boxes.push({ key: sec.name, x: g.x, y: g.y, w: g.w, h: g.h });
        seen.add(sec.name);
      }
    }
  }

  // stickyId → (所在分区, 便签)。
  const stickyIndex = new Map<
    string,
    { readonly sectionName: string; readonly sticky: SourceProjection["sections"][number]["stickies"][number] }
  >();
  for (const sec of projection.sections) {
    for (const s of sec.stickies) stickyIndex.set(s.stickyId, { sectionName: sec.name, sticky: s });
  }

  const assignments: ExportAssignment[] = [];
  /** 需要搬家的便签：行区间删除 + 目标分区追加。 */
  const moves: Array<{ from: { from: number; to: number }; rawText: string; targetName: string }> = [];

  for (const pos of stickyPositions) {
    const found = stickyIndex.get(pos.stickyId);
    // markdown 里没有这个 id 的便签（客户端状态陈旧）：契约 err 闭集没有码给它，
    // 且它不对应任何可归区的文本 ⇒ 不产生 assignment、不动文档，如实跳过。
    if (found === undefined) continue;

    const verdict = assignStickyToBox({ x: pos.x, y: pos.y }, boxes);
    // 无几何模板：保持原分区（见文件头）。
    const targetName = verdict === null ? found.sectionName : verdict.key;
    assignments.push({
      stickyId: pos.stickyId,
      sectionId: sectionIdByName.get(targetName)!,
      nearestFallback: verdict === null ? false : verdict.nearestFallback,
    });
    if (targetName !== found.sectionName) {
      moves.push({ from: found.sticky.lines, rawText: found.sticky.rawText, targetName });
    }
  }

  if (moves.length === 0) {
    return { markdown, assignments };
  }

  // ── 围栏原位替换、保序：只删被移动的行、只在目标段落末尾追加，其余行逐字节不动 ──
  const removed = new Set<number>();
  for (const m of moves) for (let n = m.from.from; n <= m.from.to; n++) removed.add(n);

  // 每个分区（取首个同名标题）的追加点：段落区间内最后一条**保留**的非空行。
  const firstHeadingByName = new Map<string, number>();
  const sectionEndByHeading = new Map<number, number>();
  for (let i = 0; i < projection.sections.length; i++) {
    const sec = projection.sections[i]!;
    if (!firstHeadingByName.has(sec.name)) firstHeadingByName.set(sec.name, sec.headingLine);
    const next = projection.sections[i + 1];
    sectionEndByHeading.set(sec.headingLine, next ? next.headingLine - 1 : projection.lines.length);
  }
  const appendAt = new Map<number, string[]>();
  for (const m of moves) {
    const headingLine = firstHeadingByName.get(m.targetName)!;
    let anchor = sectionEndByHeading.get(headingLine)!;
    while (
      anchor > headingLine &&
      (removed.has(anchor) || projection.lines[anchor - 1]!.trim() === "")
    ) {
      anchor--;
    }
    const bucket = appendAt.get(anchor) ?? [];
    // 原文（含颜色标记）原样搬运；段落块搬运后按引擎序列化约定收敛为单行列表项。
    bucket.push(`- ${m.rawText}`);
    appendAt.set(anchor, bucket);
  }

  const out: string[] = [];
  for (let n = 1; n <= projection.lines.length; n++) {
    if (!removed.has(n)) out.push(projection.lines[n - 1]!);
    const appended = appendAt.get(n);
    if (appended) out.push(...appended);
  }
  return { markdown: out.join("\n"), assignments };
}

export async function exportCanvasSource(
  deps: ExportCanvasSourceDeps,
  input: ExportCanvasSourceInput,
): Promise<ExportCanvasSourceOutput> {
  // ① 实例头。err 闭集缺 INSTANCE_NOT_FOUND 的处置同 update-canvas-source.ts ①。
  const instance = await deps.instances.findInstance(input.orgId, input.instanceId);
  if (instance === null) throw new CanvasError("INSTANCE_NOT_FOUND");

  // ② 组归属判定，先于任何内容读取（见文件头）。
  const membership = await deps.identity.findProjectMembership(
    input.userId, instance.workshopId, input.orgId,
  );
  if (membership === null || membership.groupId !== instance.groupId) {
    throw new CanvasError("NOT_IN_GROUP");
  }

  // ③ head 版本源码 + 冻结分区。
  const version = await deps.instances.findVersion(input.orgId, input.instanceId, undefined);
  if (version === null) throw new CanvasError("INSTANCE_NOT_FOUND");
  const content = await deps.instances.findTemplateContent(
    input.orgId, instance.templateKey, instance.templateVersion,
  );
  if (content === null) {
    throw new Error(
      `canvas template ${instance.templateKey}@${instance.templateVersion} 不存在，但实例 ${instance.instanceId} 冻结着它`,
    );
  }

  return projectExportFace(
    version.markdown, instance.templateKey, content.sections, input.stickyPositions,
  );
}
