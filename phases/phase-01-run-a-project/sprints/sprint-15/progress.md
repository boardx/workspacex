# 进度日志 — Sprint 01/15

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F961（进行中）
- 当前 blocker: 无

## 会话记录
### 2026-08-18（人类要求「按照 UI prototype 来修改」）
- 本轮目标: F961 —— 项目筹备组卡按**已签原型**补齐，并把 F960 的后端接到界面上。
  F950（#1482）与 F960（#1510）均已合入 main，F960 notes ④ 里写明「留给下一个 feature」
  的前置条件（真实 groupId）成立。
- 已完成:
  - 前端 API 封装：`lib/live-project-prep.ts` 加 `getInterviewSubjects`/`saveInterviewSubjects`
    + `INTERVIEW_SUBJECT_COLUMNS`（六列表头逐字照 `uc-2-2` R3 第 6 步与契约字段顺序）。
  - 组卡三处按原型收敛（`components/project/tab-prep.tsx`）：
    ① 组员一行改回显示**人数**（原型与 `mock/project.ts` 都是「3 人」；F950 写成姓名
       拼接是实现时的自由发挥，本次按签核过的原型收回，姓名在编辑态勾选框里仍可见）；
    ② 新增**访谈对象**摘要行（未填 = 「未填」，单组读失败 = 「读取失败」，别组不受影响）；
    ③ 组卡可展开出**六列对象表**，可加行/逐格填/删行/整批提交，冲突提示不覆盖对方。
  - 角色门槛：新增 `ROLE_GROUP_SUBMIT`（引导师 + 组长）——访谈对象表属「本组产出」，
    后端 `canUpdateInterviewSubjects` 复用 `group.submitOutput`，**不是** facilitator-only。
    用错会让组长看不到自己有权限用的入口。
  - `[AI 建议人选]`：原型有此按钮，但 AI 选人能力全仓无实现 ⇒ 禁用 + 如实说明，
    不做点了没反应的假入口（同 F950 对「AI 生成定题」、F185 对未接线菜单项的纪律）。
- 运行过的验证:
  - `tests/ui/project-prep-interview-subjects.test.tsx`（新，10 条）✅
  - `tests/ui/project-prep-live.test.tsx`（F950 既有，回归）✅
  - **三条反证**（本仓「写完门控立刻造反证」纪律）：把组员改回姓名拼接 / 把组长权限
    退化成 facilitator-only / 把并发冲突改成静默丢弃用户输入——三次都**只红对应的
    那一条断言**，证明这些断言不是空转的。
  - 真栈 e2e `e2e/interview-subjects-smoke.spec.ts`（新）：见下。
- 已记录证据: `evidence/F961.verify.log`（待 verify 跑完写入）。
- 提交记录: 见本次 PR（branch `worker/dev-project-01-prepui`）。
- 已知风险或未解决问题:
  - **真栈 e2e 是本次最重要的一块**：F960 的全部断言都在服务端，「浏览器能不能真的
    走到这两条端点」（Next `/projects/:path*` 代理对这条新路径是否生效）此前**从未被
    证过**——这正是本仓反复栽的「契约签了、后端绿了、界面接不上，而测试依旧全绿」。
    新 spec 走完整链路：Chromium → Next 代理 → NestJS → pg → PostgreSQL，
    并用 `page.reload()` 区分「写进了库」与「写进了 React state」。
  - 种子里 sentinel 工作坊**没有分组**，所以 e2e 第一步先用界面真实建一个组再填对象；
    全仓 `grep project-prep-groups` 确认没有别的 spec 断言「分组为空」，不会写脏别人。
  - 议程三角色分工表仍是 mock（契约无出处，同 F950/F172 的既有判定），本次未动。
- 下一步最佳动作: ① 「现场协作」「成果沉淀」「待办」三个 tab 连契约都没有，要做得先走
  完整的 requirements → 契约设计 → 人类签核流程；② PJ-12 蓝本发布版本端点；
  ③ 研究洞察 tab（后端无「洞察」概念，之前人类已明确选择延后）。
