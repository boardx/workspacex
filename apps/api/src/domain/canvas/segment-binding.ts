/**
 * F102 — 议程环节绑定模板与 skill + 现场实例化。
 *
 * 本文件只管三条可断言的不变量：
 *   I-6：同一 `agendaSegmentId` 的模板绑定数 ≤ 2（`SEGMENT_TEMPLATE_LIMIT`）。
 *   I-5 新增绑定半条：已归档（或未发布）模板不可被**新增**绑定（复用 F101 的
 *        `canCreateNewBinding`，不重写第二份判定）。
 *   #1468：议程环节的 skill 白名单**恒等于**它的绑定集合——名字查不到的绑定退回
 *        `skillKey` 显示，不丢行（`projectSegmentSkillWhitelist`，理由见该函数注释）。
 *        「同一环节同一 skillKey 只有一条绑定」由唯一约束判，见该迁移文件头。
 *
 * ## 「现场实例化」的反向断言（本 feature 的核心）
 *
 * `SegmentTemplateBinding` 在**绑定那一刻**记下 `boundTemplateVersion`
 * （domain.md：「记录绑定时的版本号」）——它此后不再随模板注册表变化而更新。
 * `instantiateForSegment` 只读这个已冻结的字段，从不重新查询模板当前状态或版本。
 *
 * 这与 F101 的 I-4（`CanvasInstance` 冻结自己建出时的版本）是**同一个模式在上一层
 * 的重复出现**：F101 防的是「实例建成后，模板发新版不改写实例」；F102 防的是
 * 「绑定建成后，模板发新版/归档不改写绑定，进而不改写靠这个绑定实例化出来的画布」。
 * 反向断言：**先实例化，后改模板**（发布新版本 / 归档），再检查——已实例化的环节
 * 的产物必须逐字节不变，而不是正向地只测「绑定时状态正确」。
 *
 * 因此本文件不重新发明冻结逻辑，直接复用 `instance-version-freeze.ts` 的
 * `createInstance` / `readFrozenTemplateRef`——第二份冻结实现是本仓明确要收敛掉的
 * 「同一事实两处声明」。
 */
import type { z } from "zod";
import { canvas as C } from "@repo/contracts";
import { canCreateNewBinding, type TemplateStatus } from "./template-lifecycle";
import { createInstance, readFrozenTemplateRef } from "./instance-version-freeze";

/** I-6：同一议程环节的模板绑定数上限（[Backlog] 上限，非探明自蓝本原型） */
export const SEGMENT_TEMPLATE_BINDING_LIMIT = 2;

/** `SegmentTemplateBinding` 实体（domain.md）——绑定时冻结 `boundTemplateVersion`，此后不变。 */
export interface SegmentTemplateBinding {
  readonly bindingId: string;
  readonly agendaSegmentId: string;
  readonly templateKey: string;
  readonly boundTemplateVersion: number;
}

export type BindTemplateFailureReason = "TEMPLATE_NOT_FOUND" | "TEMPLATE_ARCHIVED" | "SEGMENT_TEMPLATE_LIMIT";

export type BindTemplateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BindTemplateFailureReason };

/**
 * `bindTemplateToSegment` 的纯判定部分。不做 I/O：调用方（application 层）负责
 * 把既有绑定过滤到目标 `agendaSegmentId`、把模板当前状态查出来传入
 * （`undefined` = 模板不存在，对应 `TEMPLATE_NOT_FOUND`）。
 *
 * ⚠ 判定顺序是刻意的：先查模板是否存在，再查是否可绑（archived/draft/trial 一律
 * 拒绝新增绑定），最后才查数量上限——三条互不依赖，任何一条失败即返回，不用
 * 猜测调用方想先看到哪个错误。
 */
export function canBindTemplateToSegment(params: {
  readonly existingBindingsForSegment: readonly SegmentTemplateBinding[];
  readonly templateStatus: TemplateStatus | undefined;
}): BindTemplateResult {
  if (params.templateStatus === undefined) return { ok: false, reason: "TEMPLATE_NOT_FOUND" };
  if (!canCreateNewBinding(params.templateStatus)) return { ok: false, reason: "TEMPLATE_ARCHIVED" };
  if (params.existingBindingsForSegment.length >= SEGMENT_TEMPLATE_BINDING_LIMIT) {
    return { ok: false, reason: "SEGMENT_TEMPLATE_LIMIT" };
  }
  return { ok: true };
}

/* ─────────────────────────── 现场实例化 ─────────────────────────── */

/** `instantiateForSegment` 输出里的一条：某一分组实例化出的画布。 */
export interface GroupInstance {
  readonly instanceId: string;
  readonly groupId: string;
  readonly templateKey: string;
  readonly templateVersion: number;
}

/**
 * 幂等且反向断言成立的现场实例化。
 *
 * - **幂等重放**：同一 `idempotencyKey` 命中 `existingByIdempotencyKey` 时直接返回
 *   既有那一批，不产生第二批画布——现场网络抖动重试是常态。
 * - **反向断言**：新建实例时只读 `binding.boundTemplateVersion`（绑定当时冻结的值），
 *   从不查询模板注册表「现在」是什么版本、什么状态。归档模板的存量绑定也据此
 *   照常实例化成功（O-10 ②），因为本函数根本不看模板状态。
 */
export function instantiateForSegment(params: {
  readonly binding: SegmentTemplateBinding;
  readonly groupIds: readonly string[];
  readonly idempotencyKey: string;
  readonly existingByIdempotencyKey: ReadonlyMap<string, readonly GroupInstance[]>;
  readonly makeInstanceId: (groupId: string) => string;
}): readonly GroupInstance[] {
  const existing = params.existingByIdempotencyKey.get(params.idempotencyKey);
  if (existing) return existing;

  return params.groupIds.map((groupId): GroupInstance => {
    const instanceId = params.makeInstanceId(groupId);
    // 复用 F101 的冻结原语，而不是在这一层重新决定"实例记住哪个版本"——
    // 冻结的唯一事实源必须只有一处。
    const record = createInstance(instanceId, params.binding.templateKey, params.binding.boundTemplateVersion);
    const ref = readFrozenTemplateRef(record);
    return { instanceId, groupId, templateKey: ref.templateKey, templateVersion: ref.templateVersion };
  });
}

/* ─────────────────────────── skill 绑定（#1468）─────────────────────────── */

/**
 * `SegmentSkillBinding` 实体（domain.md：「skill 绑定同构：`agendaSegmentId` × `skillKey` ×
 * `runMode`」）。
 *
 * ⚠ 与 `SegmentTemplateBinding` **同构但不同实体**：没有「绑定时冻结的版本号」，也不受
 *   I-6 的「同一环节最多两个」约束——那条上限的出处（`usecases.md` uc-7-1 R7 的双列表格）
 *   只说模板。给 skill 也安一个上限，就是替产品发明一条没人签过的不变量。
 */
export interface SegmentSkillBinding {
  readonly bindingId: string;
  readonly skillKey: string;
  readonly runMode: SegmentSkillRunMode;
}

/** 契约 `SkillRunMode` 的类型侧，**不另抄一份字面量**（第二份枚举是本仓明令收敛的形状）。 */
export type SegmentSkillRunMode = z.infer<typeof C.SkillRunMode>;

/** 白名单里的一条，字段与契约 `listSegmentSkills.out.skills[]` 逐字对应。 */
export interface SegmentSkillListing {
  readonly skillKey: string;
  readonly displayName: string;
  readonly runMode: SegmentSkillRunMode;
  readonly lastRunAt: string | null;
}

/**
 * 绑定行 → 左栏第三区白名单（`listSegmentSkills.out.skills`）。
 *
 * ## 这里只有一条判定，而它是一条**不丢行**的判定
 *
 * 绑定表对 `skills` **没有外键**（理由见 `20260921140000_canvas_segment_skill_bindings.sql`
 * 文件头：契约的 `bindSkillToSegment.err` 里没有 `SKILL_NOT_FOUND`，加外键就是造一种
 * 回不出码的拒绝）。于是一条绑定可能指向一个今天查不到名字的 `skillKey`——它被禁用、
 * 被硬删、或者本来就是先绑后建。契约的 `out` 里没有「这个 skill 还在不在」这一栏，
 * 所以只有两种可能的处置：
 *
 * · **把这行从白名单里去掉** ⇒ 白名单与「绑定是否存在」这个事实开始分叉。
 *   `runSegmentSkill` 判的是绑定（I-32「未绑定即拒绝」），不是名字查不查得到：
 *   于是会出现一个**列表里没有、却能跑**的 skill，而且没有任何东西会报警。
 * · **保留这行，名字退回 `skillKey` 本身** ⇒ 白名单恒等于绑定集合，界面上显示的是一个
 *   不那么好看但真实的名字。
 *
 * ⇒ 取后者。`displayName` 是给人看的字符串，不是判定依据；而「少一行」会让两处对同一
 *   事实（这个环节绑了哪些 skill）的回答不一致——本仓五次漂移里反复出现的正是这个形状。
 */
export function projectSegmentSkillWhitelist(
  rows: readonly {
    readonly skillKey: string;
    readonly displayName: string | null;
    readonly runMode: SegmentSkillRunMode;
    readonly lastRunAt: string | null;
  }[],
): readonly SegmentSkillListing[] {
  return rows.map((row) => ({
    skillKey: row.skillKey,
    // ⚠ `?? row.skillKey` 而不是 `|| row.skillKey`：空字符串是 `skills.name` 的
    //   CHECK 挡掉的东西（`length(name) > 0`），真出现在这里说明查询串错了列，
    //   用 `||` 会把那种错误静默伪装成「这个 skill 没名字」。
    displayName: row.displayName ?? row.skillKey,
    runMode: row.runMode,
    lastRunAt: row.lastRunAt,
  }));
}
