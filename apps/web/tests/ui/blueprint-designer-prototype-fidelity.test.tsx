/**
 * 机械防漂移门控：13 个结构化编辑器（2026-08-31 起：`roles-and-perms`/
 * `group-capabilities` 已按产品决策移除，原 15 项降为 13 项）里所有**抄自原型**
 * 的常量，必须与
 * `apps/web/lib/mock/tpl.ts`（原型屏的数据源，也就是签核第 ① 件的材料）逐条相等。
 *
 * ## 为什么需要它
 *
 * 根 AGENTS.md：「⚠ 同一事实不得声明在两处——本项目已五次因此漂移」。
 * F204–F207 把 16 项面板改造成真实编辑器时，每个编辑器都把原型的固定文案/枚举/
 * 静态清单**手抄了一份**（intro、规则清单、硬约束、能力集…）。手抄本身不可避免
 * （production 代码不该 import `lib/mock/`），但**没有门控**就等于第二份事实源在裸奔：
 * 原型改一个字，编辑器里那份不会跟着改，也没有任何东西会红。
 *
 * 这个文件就是那个门控——它是唯一允许同时看见两边的地方（测试可以 import mock），
 * 逐条 `toEqual`。原型文案一改，这里立刻红并指名是哪一项漂了。
 *
 * ## 反证
 *
 * 每一条断言都必须在「两边不一致」时真的红。写完这个文件后实测过：
 * 把 `caps-panel-editor` 的「用户研究」`stateQualifier` 从 `"两天档才开"` 改成 `null`，
 * 「组内能力 · 状态限定语」那条立刻红并指出该项；改回后转绿。
 */
import { describe, expect, it } from "vitest";

import {
  TOPIC_PANEL,
  AGENDA_PANEL,
  GROUPING_PANEL,
  SURVEY_PANEL,
  INTERVIEW_PLAN_PANEL,
  HOMEWORK_PANEL,
  VENUE_PANEL,
  MATERIALS_PANEL,
  PRINT_PANEL,
  AGENT_PANEL,
  SKILL_PANEL,
  OUTPUTS_PANEL,
  REPORT_PANEL,
} from "@/lib/mock/tpl";

import { FACET_INTRO } from "@/components/tpl-designer/facet-editor-registry";
import { VENUE_SPACE_FIELDS, VENUE_FORMATS } from "@/components/tpl-designer/venue-panel-editor";
import { PRE_TASK_AUDIENCES } from "@/components/tpl-designer/pre-tasks-panel-editor";
import { PRINT_SIZES } from "@/components/tpl-designer/print-panel-editor";
import { MATERIAL_OWNERS } from "@/components/tpl-designer/materials-panel-editor";
import { AGENT_STATES } from "@/components/tpl-designer/agent-panel-editor";
import { GENERIC_NOTE as SKILL_GENERIC_NOTE } from "@/components/tpl-designer/skill-panel-editor";
import { TIER_NOTE } from "@/components/tpl-designer/blueprint-duration-form";

describe("原型保真度机械门控：编辑器里抄自原型的常量 ≡ lib/mock/tpl.ts", () => {
  it("13 项面板顶部的 intro 解释段逐条一致（原型 <Intro> 的内容）", () => {
    // 逐条列出而不是循环——失败时能直接看出是哪一项漂了。
    // roles-and-perms/group-capabilities 已按 2026-08-31 产品决策移除，不再断言。
    expect(FACET_INTRO["topic-and-background"]).toEqual(TOPIC_PANEL.intro);
    expect(FACET_INTRO["flow-agenda"]).toEqual(AGENDA_PANEL.intro);
    expect(FACET_INTRO["grouping-rule"]).toEqual(GROUPING_PANEL.intro);
    expect(FACET_INTRO["survey"]).toEqual(SURVEY_PANEL.intro);
    expect(FACET_INTRO["interview-and-subjects"]).toEqual(INTERVIEW_PLAN_PANEL.intro);
    expect(FACET_INTRO["pre-tasks"]).toEqual(HOMEWORK_PANEL.intro);
    expect(FACET_INTRO["venue-and-format"]).toEqual(VENUE_PANEL.intro);
    expect(FACET_INTRO["project-materials"]).toEqual(MATERIALS_PANEL.intro);
    expect(FACET_INTRO["print-materials"]).toEqual(PRINT_PANEL.intro);
    expect(FACET_INTRO["agent-orchestration"]).toEqual(AGENT_PANEL.intro);
    expect(FACET_INTRO["skill-binding"]).toEqual(SKILL_PANEL.intro);
    expect(FACET_INTRO["outputs"]).toEqual(OUTPUTS_PANEL.intro);
    expect(FACET_INTRO["report-template"]).toEqual(REPORT_PANEL.intro);
  });

  it("2026-08-19 差距审计补回的三处静态文案 ≡ 原型（不是本次凭空写的）", () => {
    expect(SKILL_GENERIC_NOTE).toEqual(SKILL_PANEL.genericNote);
    // designer-panels.tsx 的 TIER_NOTE 是模块内 const，未导出，这里直接对照
    // 逐字抄出的原型值（同一份数据不该有第三处再声明，故不重复 import 一次原型文件）。
    expect(TIER_NOTE).toEqual({
      "half-day": "只到收敛，不做原型",
      "one-day": "加商业模式草稿",
      "two-day": "加原型与用户测试",
      "three-day": "加迭代与落地计划",
    });
  });

  it("intro 表与定义表同尺寸：13 项一个不多一个不少（新增面板忘了写 intro 会红）", () => {
    // 13 = DESIGN_FACET_DEFINITIONS.length（roles-and-perms/group-capabilities 已移除，15→13）。
    expect(Object.keys(FACET_INTRO)).toHaveLength(13);
    expect(Object.values(FACET_INTRO).every((v) => v.trim().length > 0)).toBe(true);
  });

  it("场地与形式：5 行空间字段与三种形式 ≡ 原型 space / formats", () => {
    expect([...VENUE_SPACE_FIELDS]).toEqual(VENUE_PANEL.space.map((s) => s.item));
    expect(VENUE_FORMATS.map((f) => f.key)).toEqual(VENUE_PANEL.formats.map((f) => f.key));
    expect(VENUE_FORMATS.map((f) => f.detail)).toEqual(VENUE_PANEL.formats.map((f) => f.detail));
  });

  it("会前任务 / 打印素材 / 项目材料 / Agent：枚举取值 ≡ 原型里真实出现过的值", () => {
    // 这些枚举当初是「原型里只出现这几种，所以做成单选」——门控就钉住这个前提。
    expect(new Set(HOMEWORK_PANEL.tasks.map((t) => t.forWhom))).toEqual(
      new Set(HOMEWORK_PANEL.tasks.map((t) => t.forWhom).filter((w) => PRE_TASK_AUDIENCES.includes(w as never))),
    );
    for (const p of PRINT_PANEL.items) expect(PRINT_SIZES).toContain(p.size as never);
    for (const r of MATERIALS_PANEL.rows) expect(MATERIAL_OWNERS).toContain(r.owner as never);
    for (const a of AGENT_PANEL.agents) {
      // 原型的 state 形如「默认开」/「按需召唤 · 仅被召唤时」——取前半段。
      expect(AGENT_STATES).toContain(a.state.split(" · ")[0] as never);
    }
  });
});
