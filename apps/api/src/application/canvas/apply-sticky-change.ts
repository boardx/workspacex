/**
 * `applyStickyChange`（#1493 / UC-7.3 第三块）—— 便签级写，LWW（D-09）。
 *
 * ## LWW 判定完整复用 `domain/canvas/sticky-lww.ts`，不写第二份
 *
 * 「谁的 clientTs 更晚谁生效、打平新写生效、输家仍留痕」全部在 domain 的
 * `applyStickyChange` 里（含「为什么按 clientTs 不按到达序」的论证）。本文件只负责
 * 把持久面（`canvas_sticky_revisions` 的 current 行）翻译成 domain 的 `StickyState`、
 * 再把判定结果落库。`supersededRevisionId` 可回查（I-19）是存储结构保证的：
 * 每次调用都追加一行修订，被覆盖的那行还在（is_current=false），没有 DELETE 路径。
 *
 * ## 写入面 = 对 markdown 里目标便签行的原位修改（D-08：文本是唯一事实源）
 *
 * `patch` 五个字段分两类：
 * · **改文本**（text / color / sectionId）：重写 head markdown——只动目标便签的行
 *   （text/color = 原行替换；sectionId = 删原行 + 目标段落末尾追加，同
 *   `export-canvas-source.ts` 的搬运纪律），其余行逐字节不变（e2e 反证钉住），
 *   并追加一个新版本行（同 `updateSource` 的 CTE，判定与写入同一条语句）。
 *   颜色的持久形态沿用引擎既有的尾部 ` #颜色名` 标记（`STICKY_COLORS` 是名字与
 *   hex 的唯一权威；缺省黄不写标记——引擎序列化的同一条约定）。
 * · **不改文本**（position / size）：markdown 里**没有**它们的承载——坐标不写回
 *   文本是 I-9/D-08 ② 的硬约束（写了就违反），尺寸则是文本语法没有的标记，发明
 *   一个新内联标记会被引擎当成便签文本、破坏 164+ 单测钉住的往返（vendor 不改）。
 *   两者只落在修订行的 `patch` jsonb 里（可查、可回放），不推进版本。这是**如实
 *   登记的缺口**：position/size 的读模型（renderCanvas 的 `size: null`）本块不变，
 *   接通要么等布局快照旁路、要么等人类裁决给尺寸设计文本标记。
 *
 * ## 契约 err 闭集的两个「故意没有」与一个「不可达」
 *
 * · `CONFLICT_PENDING_ADJUDICATION` **故意不在** err 里（I-18，契约注释原话
 *   「现场不能因一条冲突全组停手」）——本文件不查任何冲突状态，结构性冲突的
 *   持久层（第四块）落地后也**不需要**回来改这里。
 * · `VERSION_CHANGED` 不在 err 里：LWW 没有「乐观并发失败弹给用户」这一说。
 *   并发推进 head 时（repo 返回 `"head_moved"`）本用例基于新 head **重算重试**，
 *   重试耗尽才退 `DEPENDENCY_UNAVAILABLE`（这是诚实的：持续撞车 = 服务当下
 *   给不出结果，让客户端稍后再试，而不是借一个语义不符的码）。
 * · `AUTHORIZATION_REVOKED` 在 err 闭集里但**本块不可达**：撤权的判定输入
 *   （会中撤销授权的状态存储）本仓尚未落地，组归属判定只能看
 *   `project_memberships` 的当前行——行没了/换组了走 `NOT_IN_GROUP`。
 *
 * ## 鉴权：组内动作，判定与 `updateSource` 同一条
 *
 * 调用者的项目成员行 `group_id` 必须等于实例的 `group_id`；非成员与别组成员
 * 同一个 `NOT_IN_GROUP` 出口（update-canvas-source.ts 文件头的论证逐字适用）。
 */
import { createHash } from "node:crypto";
import { STICKY_COLORS } from "@repo/fabric-markdown/diagrams/template-engine";
import {
  applyStickyChange as applyStickyLww,
  type StickyPatch,
} from "../../domain/canvas/sticky-lww";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import {
  CanvasError,
  CanvasStickyNotFoundError,
  CanvasUnknownSectionError,
  CanvasUnknownStickyColorError,
} from "./errors";
import type { CanvasInstanceRepository, TemplateSectionFacts } from "./instance-ports";
import { derivedSectionId, projectSource } from "./source-projection";

export interface ApplyStickyChangeDeps {
  readonly identity: IdentityRepository;
  readonly instances: CanvasInstanceRepository;
  readonly newVersionId: () => string;
  readonly newRevisionId: () => string;
}

export interface ApplyStickyChangeInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly instanceId: string;
  readonly stickyId: string;
  readonly patch: StickyPatch;
  readonly clientTs: string;
}

export interface ApplyStickyChangeOutput {
  readonly stickyId: string;
  readonly appliedTs: string;
  readonly supersededRevisionId: string | null;
}

const HEX_BY_NAME = STICKY_COLORS;
const NAME_BY_HEX = new Map(Object.entries(HEX_BY_NAME).map(([name, hex]) => [hex, name]));

/** `patch.color`（名字或 hex）→ 注册颜色名；两边都不认识 ⇒ 裸 400（errors.ts）。 */
function resolveColorName(color: string): string {
  if (HEX_BY_NAME[color]) return color;
  const byHex = NAME_BY_HEX.get(color);
  if (byHex !== undefined) return byHex;
  throw new CanvasUnknownStickyColorError(color);
}

export interface StickyMarkdownMutation {
  readonly markdown: string;
  /** false = patch 只含 position/size，文本一个字节不动（见文件头）。 */
  readonly changed: boolean;
}

/**
 * 原位修改的纯函数：head markdown + stickyId + patch → 新 markdown。
 * 单独导出：逐字节不变的反证单测直接打它，e2e 打整条 HTTP 链，两边是同一个函数。
 */
export function applyStickyPatchToMarkdown(
  markdown: string,
  stickyId: string,
  patch: StickyPatch,
  templateSections: readonly TemplateSectionFacts[],
): StickyMarkdownMutation {
  const projection = projectSource(markdown);

  let found:
    | { sectionName: string; sticky: (typeof projection.sections)[number]["stickies"][number] }
    | undefined;
  for (const sec of projection.sections) {
    for (const s of sec.stickies) {
      if (s.stickyId === stickyId) found = { sectionName: sec.name, sticky: s };
    }
  }
  if (found === undefined) throw new CanvasStickyNotFoundError(stickyId);

  const touchesText =
    patch.text !== undefined || patch.color !== undefined || patch.sectionId !== undefined;
  if (!touchesText) return { markdown, changed: false };

  // ── 新的条目原文：text / color 叠在既有值上（sectionId-only 的搬运原文不变）──
  const text = patch.text ?? found.sticky.text;
  const colorName =
    patch.color !== undefined
      ? resolveColorName(patch.color)
      : found.sticky.color !== null
        ? NAME_BY_HEX.get(found.sticky.color)!
        : null;
  // 缺省黄不写标记（引擎序列化约定，STICKY_COLORS 注释逐字）。
  const rawText = colorName !== null && colorName !== "yellow" ? `${text} #${colorName}` : text;

  // ── 目标段落：sectionId 缺省 = 原地；给了 = 冻结分区名或派生 `md:<名字>` ──
  let targetName = found.sectionName;
  if (patch.sectionId !== undefined) {
    const byTemplate = templateSections.find((s) => s.sectionId === patch.sectionId);
    const name =
      byTemplate?.name ??
      projection.sections.find((s) => derivedSectionId(s.name) === patch.sectionId)?.name;
    // 模板里有名字但 markdown 里没有这个 `## 段落` ⇒ 没有可追加的位置，同样是未知分区。
    if (name === undefined || !projection.sections.some((s) => s.name === name)) {
      throw new CanvasUnknownSectionError(patch.sectionId);
    }
    targetName = name;
  }

  // ── 行重写：删原行区间；原地改 = 原位置放新行，搬运 = 目标段落末尾追加 ──
  // （追加锚点规则与 export-canvas-source.ts 一致：段落区间内最后一条非空行。）
  const removed = new Set<number>();
  for (let n = found.sticky.lines.from; n <= found.sticky.lines.to; n++) removed.add(n);

  const newLine = `- ${rawText}`;
  const inPlace = targetName === found.sectionName;

  let appendAnchor = -1;
  if (!inPlace) {
    let headingLine = -1;
    for (const sec of projection.sections) {
      if (sec.name === targetName) { headingLine = sec.headingLine; break; }
    }
    const idx = projection.sections.findIndex((s) => s.headingLine === headingLine);
    const next = projection.sections[idx + 1];
    let anchor = next ? next.headingLine - 1 : projection.lines.length;
    while (
      anchor > headingLine &&
      (removed.has(anchor) || projection.lines[anchor - 1]!.trim() === "")
    ) {
      anchor--;
    }
    appendAnchor = anchor;
  }

  const out: string[] = [];
  for (let n = 1; n <= projection.lines.length; n++) {
    if (removed.has(n)) {
      // 原地修改：新行落在原区间的第一行位置（段落块收敛为单行列表项，同 export 的约定）。
      if (inPlace && n === found.sticky.lines.from) out.push(newLine);
    } else {
      out.push(projection.lines[n - 1]!);
    }
    if (!inPlace && n === appendAnchor) out.push(newLine);
  }
  const next = out.join("\n");
  return { markdown: next, changed: next !== markdown };
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** head 被并发推进时的重算次数上限（见文件头「VERSION_CHANGED 不在 err 里」）。 */
const MAX_HEAD_RETRIES = 5;

export async function applyStickyChange(
  deps: ApplyStickyChangeDeps,
  input: ApplyStickyChangeInput,
): Promise<ApplyStickyChangeOutput> {
  // ① 实例头。
  const instance = await deps.instances.findInstance(input.orgId, input.instanceId);
  if (instance === null) throw new CanvasError("INSTANCE_NOT_FOUND");

  // ② 组归属（见文件头）。非成员与别组成员同一个出口。
  const membership = await deps.identity.findProjectMembership(
    input.userId, instance.workshopId, input.orgId,
  );
  if (membership === null || membership.groupId !== instance.groupId) {
    throw new CanvasError("NOT_IN_GROUP");
  }

  // sectionId 映射需要冻结分区名（与 render/export 同一条解析规则）。
  const content = await deps.instances.findTemplateContent(
    input.orgId, instance.templateKey, instance.templateVersion,
  );
  if (content === null) {
    throw new Error(
      `canvas template ${instance.templateKey}@${instance.templateVersion} 不存在，但实例 ${instance.instanceId} 冻结着它`,
    );
  }

  for (let attempt = 0; attempt < MAX_HEAD_RETRIES; attempt++) {
    // ③ head 源码——每轮重试重读（重算基底必须是当前 head，否则会吃掉别人的行）。
    const version = await deps.instances.findVersion(input.orgId, input.instanceId, undefined);
    if (version === null) throw new CanvasError("INSTANCE_NOT_FOUND");

    const mutation = applyStickyPatchToMarkdown(
      version.markdown, input.stickyId, input.patch, content.sections,
    );

    // ④ LWW 判定（domain，唯一实现）。current 行 → StickyState；历史行不参与判定，
    //    留空数组——I-19 的可回查性由表结构保证，不需要把全部历史搬进内存。
    const current = await deps.instances.findCurrentStickyRevision(
      input.orgId, input.instanceId, input.stickyId,
    );
    let incomingRevisionId = "";
    const verdict = applyStickyLww({
      state: {
        stickyId: input.stickyId,
        current:
          current === null
            ? null
            : { revisionId: current.revisionId, appliedTs: current.clientTs, patch: current.patch },
        history: [],
      },
      patch: input.patch,
      clientTs: input.clientTs,
      makeRevisionId: () => (incomingRevisionId = deps.newRevisionId()),
    });
    const winning =
      verdict.nextState.current !== null &&
      verdict.nextState.current.revisionId === incomingRevisionId;

    // ⑤ 落库：修订行 +（生效且改了文本时）版本行，同一个事务（repo 文件头）。
    //    输掉 LWW 的迟到写不动 markdown——「较早那次不是被丢弃」指的是它落成历史行。
    const outcome = await deps.instances.applyStickyRevision({
      orgId: input.orgId,
      instanceId: input.instanceId,
      stickyId: input.stickyId,
      revisionId: incomingRevisionId,
      patch: input.patch,
      clientTs: input.clientTs,
      winning,
      createdBy: input.userId,
      ...(winning && mutation.changed
        ? {
            newVersion: {
              expectedHeadVersion: version.version,
              versionId: deps.newVersionId(),
              markdown: mutation.markdown,
              contentHash: sha256(mutation.markdown),
            },
          }
        : {}),
    });
    if (outcome === "head_moved") continue;

    return {
      stickyId: input.stickyId,
      appliedTs: verdict.appliedTs,
      supersededRevisionId: verdict.supersededRevisionId,
    };
  }
  // 连续 MAX_HEAD_RETRIES 轮 head 都被并发推进：服务当下给不出结果（见文件头）。
  throw new CanvasError("DEPENDENCY_UNAVAILABLE");
}
