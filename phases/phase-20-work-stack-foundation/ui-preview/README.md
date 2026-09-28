# Phase-20 work-stack-foundation — UI 先行原型（ADR-023 签核第 ① 件材料）

> 纯前端 + mock，不接后端、不发明后端契约（ui-prototyper 硬规则 ③）。
> 签核状态由**人类**在各束 `contracts/<束>/design-signoff.md` 改，agent 不动 status（硬规则 ①）。
>
> 预览入口：`apps/web/app/preview/work-stack/page.tsx`
> `?screen=skill-catalog|agent-directory|run-panel|gate-status|board-run`
> `?state=default|loading|empty|invalid|depfail|denied|success`
> `?role=member|admin`
> 起服务：`cd apps/web && npx next dev`，访问 `/preview/work-stack`。
> 顶部调试面板可切屏 / 切态 / 切视角（视角是**预览手段**，不是权限实现）。

## 屏 ↔ UC ↔ 束 ↔ 截图 ↔ 状态覆盖

| 屏 | UC / R8 出处 | 束 | 主截图（design_ref） | 组件 |
|---|---|---|---|---|
| Skill 目录（列表/筛选/详情抽屉） | `requirements/01-skill-catalog.md` R8 | work-skill-meta（WS05） | `skill-catalog/work-catalog-screen.png`（并复制到 `work-skill-meta/`，见开放问题 Q1） | `components/work-stack/skill-catalog-screen.tsx` |
| 门状态面板（G0–G5） | `requirements/04-eval-gates.md` R8 | work-eval（EV04） | `work-eval/gate-status-panel.png` | `gate-status-panel.tsx` / `gate-status-screen.tsx` |
| Agent 目录 + 角色详情 | `requirements/03-agent-role.md` R8 | agent-role（AG04） | `agent-role/agent-directory.png` | `agent-directory-screen.tsx` |
| Workflow 运行面板 + 审批抽屉 | `requirements/02-workflow-runtime.md` R5/R8 | workflow-runtime（WF08） | `workflow-runtime/run-panel.png` | `workflow-run-panel.tsx` |
| 看板 Workflow 运行投影 | `requirements/05-content-lines.md` R3 步骤10 | work-content（CT10） | `work-content/board-run-card.png` | `board-run-screen.tsx` |

**七态覆盖**：每屏均产出 7 张 `<uc-id>-<屏名>-<状态>.png`（default/loading/empty/invalid/depfail/denied/success），同目录。
各屏对七态的语义映射（因为部分态在某屏无天然对应，做了贴合业务的复用）：

- Skill 目录：invalid = 抽屉门状态局部加载失败（depfail 同）；empty = 列表空 + 清除筛选；denied = 统一 404 出口。
- 运行面板：invalid = **等待审批态**（审批抽屉打开）；depfail = **被拒 + 权限阻断态**（reasonCode + 拒绝理由已填、按钮禁用）；success = 全阶段完成；empty = 我的运行为空。
- 门状态：empty = 未评测（六枚灰徽章 + 通过数「—」）；invalid/depfail = 门区块局部加载失败；success = 无过期提示。
- Agent 目录：depfail = 目录加载失败；empty = 未导入官方角色包；success/default/invalid 同 happy。
- 看板：empty = 无运行卡；depfail = 投影读模型加载失败。

## 我替 UC 做了哪些它没写明的设计决定（人类请逐条看）

1. **门徽章配色映射**：pass→success(绿)、fail→danger(红)、not_applicable→neutral(灰)、not_evaluated→outline(描边)。UC 只规定文案与「绝不把 not_evaluated 渲染成通过」，未规定颜色。我把 not_evaluated 做成描边弱化态以与 not_applicable 区分。
2. **列表门缩略格式**：UC 举例「G4✓ G5✗」，我固定成「G4✓ G5<✓/✗>」两门缩略（只显示末两门），未展开全部六门——需确认是否够用。
3. **运行面板双栏布局**：阶段时间线（左，1.2fr）+ 实时日志（右，1fr）+ 底部操作条。UC 只列区域清单未定布局比例。
4. **审批抽屉危险动作呈现**（硬规则 ⑦）：把「写入外部系统」用红字强调 + 逐条影响项列表（3 条示例，含乐观并发版本号 v7），拒绝理由文本域在拒绝时必填。UC 说「必填理由」，二次确认的**形态**是我定的（内联抽屉而非弹窗）。
5. **Agent 头像**：用中文单字缩写（研/品/设/销）+ ai 色调，沿用既有 `Avatar` 组件（原型全用缩写，无外部图片依赖）。UC 提到 `illustration` key，我未引入插画资源，走缩写回退（符合 A3「回退首字母、不报错」）。
6. **「由 Workflow 固定」标签**：Agent 详情里未挂载但被 Workflow pin 的 Skill 标为「由 Workflow 固定」而非「未挂载」，呼应 ADR-118 #9。UC 未给该文案。
7. **看板卡状态→列映射与配色**：运行中→进行中(primary)、等待审批→待审阅(warning)、完成→已完成(success)、失败终态→已完成列 + danger 徽标「失败（可重试）」。UC（R3 步骤10）给了状态映射规则，颜色与失败徽标样式是我定的。
8. **预览视角切换器**：只做了「成员 / 管理员·平台运营」两档（R5 角色多为这两类的投影）。UC/既有项目工作台是四视角；此处按本阶段实际角色收敛为两档，请确认是否需要拆出「审批人」独立视角。

## R8 线索之间的矛盾与处理

- **截图目录名（已收敛）**：`work-skill-meta` 束的截图统一放在 `ui-preview/skill-catalog/`（与 WS05 `design_ref` 一致），束↔目录映射写在 `.harness/scripts/ui-material-map.json`；原 `work-skill-meta/` 副本已删除。
- **门状态区归属**：`work-eval/ui.md` 声明门状态区块骨架属 work-skill-meta 的 `work-skill-gates`，本束只填内容。我把 `GateStatusPanel` 做成**共享组件**，同时嵌进 Skill 抽屉与独立门状态屏，避免两套实现漂移。
- **run-panel 束↔目录映射缺口**：`workflow-runtime/ui.md` 指出需在 `.harness/scripts/ui-material-map.json` 补 `"workflow-runtime": "ui-preview/workflow-runtime"`。这属签核连带门，非本原型职责，未改脚本，仅在此登记。

## 待确认清单（签核前请人类确认）

- [ ] 目录名统一（skill-catalog vs work-skill-meta）——决定后订正 design_ref / ui-material-map。
- [ ] 门缩略只显末两门是否足够，还是要显示全部 G0–G5。
- [ ] 预览视角是否需要拆出「审批人」独立档（当前并入成员/管理员两档）。
- [ ] 审批二次确认用内联抽屉是否可接受（对比弹窗）。
- [ ] 未产出独立截图的态（ui.md 各束列的签核缺口，如 escalate/handoff 卡片、管理「角色」区块、窄屏布局）——本轮未画，是否作为 design delta 接受或要求补图。
- [ ] `board.SOURCE_KINDS` 新增「Workflow 运行」来源值属后端契约，本原型未发明字段，仅按 R3 步骤10 文字投影。

## 建议在束级 design-signoff.md 第 ① 件签核时重点核对的 3 处

1. **危险动作（硬规则 ⑦）**：运行面板 depfail/invalid 两张图——审批抽屉的影响范围说明、必填拒绝理由、已决定后按钮禁用与结果回显，是否满足 UC 对「写入外部 / 二次确认」的要求。
2. **状态真实性（硬规则 ⑤）**：门状态 empty 图必须是六枚「未评测」灰徽章 + 通过数「—」，**绝不**渲染成通过；Skill 就绪性 not_ready 显示「缺 N 项」、unknown 显示「未知」，不冒充 ready。
3. **权限投影（R5）**：切到「成员」视角时，Skill 抽屉的「切换通道/设置后继」、门状态的「标为 verified」必须**不渲染**（非管理员/非平台运营）——请对照 admin 与 member 两张图确认差异。
