/**
 * 机械防漂移门控：15 个结构化编辑器里所有**抄自原型**的常量，必须与
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
  ROLES_PANEL,
  SURVEY_PANEL,
  INTERVIEW_PLAN_PANEL,
  HOMEWORK_PANEL,
  VENUE_PANEL,
  MATERIALS_PANEL,
  PRINT_PANEL,
  CAPS_PANEL,
  AGENT_PANEL,
  SKILL_PANEL,
  OUTPUTS_PANEL,
  REPORT_PANEL,
} from "@/lib/mock/tpl";

import { FACET_INTRO } from "@/components/tpl-designer/facet-editor-registry";
import { PERMISSION_CAPABILITIES, PERMISSION_ROLES } from "@/components/tpl-designer/facet-content-editor";
import { GROUP_CAPABILITIES } from "@/components/tpl-designer/caps-panel-editor";
import { VENUE_SPACE_FIELDS, VENUE_FORMATS } from "@/components/tpl-designer/venue-panel-editor";
import { PRE_TASK_AUDIENCES } from "@/components/tpl-designer/pre-tasks-panel-editor";
import { PRINT_SIZES } from "@/components/tpl-designer/print-panel-editor";
import { MATERIAL_OWNERS } from "@/components/tpl-designer/materials-panel-editor";
import { AGENT_STATES } from "@/components/tpl-designer/agent-panel-editor";

describe("原型保真度机械门控：编辑器里抄自原型的常量 ≡ lib/mock/tpl.ts", () => {
  it("15 项面板顶部的 intro 解释段逐条一致（原型 <Intro> 的内容）", () => {
    // 逐条列出而不是循环——失败时能直接看出是哪一项漂了。
    expect(FACET_INTRO["topic-and-background"]).toEqual(TOPIC_PANEL.intro);
    expect(FACET_INTRO["flow-agenda"]).toEqual(AGENDA_PANEL.intro);
    expect(FACET_INTRO["grouping-rule"]).toEqual(GROUPING_PANEL.intro);
    expect(FACET_INTRO["roles-and-perms"]).toEqual(ROLES_PANEL.intro);
    expect(FACET_INTRO["survey"]).toEqual(SURVEY_PANEL.intro);
    expect(FACET_INTRO["interview-and-subjects"]).toEqual(INTERVIEW_PLAN_PANEL.intro);
    expect(FACET_INTRO["pre-tasks"]).toEqual(HOMEWORK_PANEL.intro);
    expect(FACET_INTRO["venue-and-format"]).toEqual(VENUE_PANEL.intro);
    expect(FACET_INTRO["project-materials"]).toEqual(MATERIALS_PANEL.intro);
    expect(FACET_INTRO["print-materials"]).toEqual(PRINT_PANEL.intro);
    expect(FACET_INTRO["group-capabilities"]).toEqual(CAPS_PANEL.intro);
    expect(FACET_INTRO["agent-orchestration"]).toEqual(AGENT_PANEL.intro);
    expect(FACET_INTRO["skill-binding"]).toEqual(SKILL_PANEL.intro);
    expect(FACET_INTRO["outputs"]).toEqual(OUTPUTS_PANEL.intro);
    expect(FACET_INTRO["report-template"]).toEqual(REPORT_PANEL.intro);
  });

  it("intro 表与定义表同尺寸：15 项一个不多一个不少（新增面板忘了写 intro 会红）", () => {
    expect(Object.keys(FACET_INTRO)).toHaveLength(15);
    expect(Object.values(FACET_INTRO).every((v) => v.trim().length > 0)).toBe(true);
  });

  it("角色与权限：能力行与角色列 ≡ 原型 permRows / roleCols", () => {
    expect([...PERMISSION_CAPABILITIES]).toEqual(ROLES_PANEL.permRows.map((r) => r.cap));
    expect([...PERMISSION_ROLES]).toEqual(ROLES_PANEL.roleCols);
  });

  it("组内能力：能力集、默认开关、必留项、状态限定语 ≡ 原型 caps", () => {
    expect(GROUP_CAPABILITIES.map((c) => c.name)).toEqual(CAPS_PANEL.caps.map((c) => c.name));

    for (const [i, proto] of CAPS_PANEL.caps.entries()) {
      const mine = GROUP_CAPABILITIES[i]!;
      // 原型的 state 形如「开」/「开 · 必留」/「关 · 两天档才开」。
      const parts = proto.state.split(" · ");
      const onOff = parts[0] ?? "";
      const qualifier = parts[1] ?? null;
      expect(mine.defaultOn, `「${proto.name}」默认开关应与原型一致`).toBe(onOff.startsWith("开"));
      expect(mine.stateQualifier, `「${proto.name}」状态限定语应与原型一致`).toEqual(qualifier);
      // 「必留」是限定语的一种，且必须同时体现为不可关。
      expect(mine.mustKeep, `「${proto.name}」必留标记应与原型一致`).toBe(qualifier === "必留");
      expect(mine.usePlaceholder, `「${proto.name}」用途说明应与原型一致`).toEqual(proto.use);
    }
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
