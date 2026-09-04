---
bundle: artifacts-steering
phase: "14"
covers: [F09, F10, F11, F12]
status: pending          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `artifacts-steering` 设计签核

覆盖：F09（Artifact 领域模型+版本化 API）、F10（前端产出物面板）、
F11（中途插话后端接口+内核处理）、F12（前端中途插话交互）。
判据单一事实源：`requirements/04-artifacts-steering.md` 的 R3/R3'/R4/R6/R12。

## 一、材料清单

- ① UI：`ui.md`（3 张截图：04 插话入口、05×2 产出物面板空态/有版本）。
- ② 用例：`usecases.md`（UC-1～UC-4）。
- ③ API 契约：`packages/contracts/src/artifacts-steering.ts`。
- 支撑·领域模型：`domain.md`（I-1～I-7）。
- 支撑·覆盖证明：`coverage.md`。

## 二、人类签核时请重点核对

1. **①UI**：A2（插话话题无关提示）与版本间可视化 diff（R6 明确增强项）两处缺口，
   `ui.md` 第四节已如实标注，请确认后者"不做"的边界是否仍然成立。
2. **②失败模式**：`RUN_NOT_RUNNING` 目前是唯一的插话失败态——`usecases.md` UC-4
   已标注"待人类确认"：run 处于非 running 非终态时插话应拒绝/排队/转换为其它
   交互，这是本轮最需要人类拍板的一个失败模式空白点。
3. **③API 契约**：`continueArtifact` 与 `interject` 都会新发起或影响一个 run，
   但本契约刻意不区分"这是不是同一逻辑 run 的延续"——`continueArtifact` 产生的
   `runId` 是全新逻辑 run（不同于 `streaming-transport` 束 F05 的"同逻辑 run 续跑"），
   这个边界是否清晰、是否需要在两束之间加一条交叉说明，请确认。
4. **不变量**：I-5/I-6（插话不打断当前调用/插话非取消）是本束用户体验的核心承诺，
   `domain.md` 已把 E3（插话与本 run 内授权范围的歧义）标注为跨束问题，
   留给阶段一致性复核处理，请核实这个划分。
5. **coverage 双向**：`getArtifact` 未被 R12 直接编号但作为前置读操作纳入覆盖，
   请确认这类"隐含前置操作"的记账方式是否可接受。
