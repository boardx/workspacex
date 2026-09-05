# 契约束 `artifacts-steering` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖 `domain.md`。翻译自 `requirements/04-artifacts-steering.md`
> R3/R3'/R4/R6，不发挥。对应 `packages/contracts/src/artifacts-steering.ts`。

## 统一失败枚举

```
ArtifactError
  NOT_VISIBLE                   调用者对该 Artifact 无可见权
  ARTIFACT_NOT_FOUND             artifactId 不存在
  ARTIFACT_VERSION_NOT_FOUND     指定版本不存在（E2：不能默默用错误版本）

InterjectError
  NOT_VISIBLE        调用者对该 run 无可见权
  RUN_NOT_RUNNING     run 不处于 running 状态，不接受插话
```

## UC-1 `getArtifact` —— 读取产出物（含版本历史概要）

```
in:  { artifactId }
out: ArtifactRecord
pre: 调用者可见该 Artifact（同组织内有权限访问该 run 的用户，R5）
err: NOT_VISIBLE | ARTIFACT_NOT_FOUND
```

## UC-2 `listArtifactVersions` —— 分页查询版本历史

```
in:  { artifactId, cursor, limit }
out: { versions: ArtifactVersionInfo[], nextCursor }
pre: 同 UC-1
err: NOT_VISIBLE | ARTIFACT_NOT_FOUND
```

失败模式：无独立分页失败态；`limit` 越界由 schema 层面拒绝（1～100）。

## UC-3 `continueArtifact` —— 基于某版本继续修改

```
in:  { artifactId, basedOnVersion, instruction }
out: { runId, artifactId }
pre: 调用者可见该 Artifact
err: NOT_VISIBLE | ARTIFACT_NOT_FOUND | ARTIFACT_VERSION_NOT_FOUND
```

失败模式：
- `ARTIFACT_VERSION_NOT_FOUND`：E2，指定版本已不存在（如被误传的过期版本号），
  拒绝而不是静默回退到最新版本。
- 新 run 执行完成后，同一 Artifact 的 `version` 递增；若该 run 以 `failed`
  终态结束，不产生新版本（I-3，`error-observability` 束的错误卡片呈现失败原因）。

## UC-4 `interject` —— 中途插话

```
in:  { runId, text }
out: { runId, interjectionId, receivedAt }
pre: run 处于 running，调用者是该 run 的发起者（R5：不支持其他协作者插话）
err: NOT_VISIBLE | RUN_NOT_RUNNING
```

失败模式：
- `RUN_NOT_RUNNING`：run 已进入其它非终态（如 `awaiting_tool_permission`）或终态，
  此时不接受插话——需求原文只描述"running 状态下"的插话流程，其余状态的插话
  行为未定义，**待人类在签核时确认**是应该拒绝、排队还是转换为该状态下的其它
  既有交互（如工具权限弹层的拒绝动作）。
- 插话发送时机与正在执行的工具调用重叠：不打断该次调用（I-5），`receivedAt`
  仍在 1 秒内返回，前端展示"已收到"反馈与该次工具调用的完成是两条独立时间线。

## 跨束委托（不在本束实现，只调用）

- Artifact/run 可见性判定 → 上游 `chat`/`identity` 束。
- 产出文件的写入路径（工具调用产出 Artifact 内容本身）→ `kernel-gateway` 束
  `proxyToolExecution`。
- 插话触发的重新规划 → `plan-permissions` 束（`plan_update` 事件复用
  `streaming-transport` 束定义，是否重新触发计划确认由内核判断，不在本束约束）。
