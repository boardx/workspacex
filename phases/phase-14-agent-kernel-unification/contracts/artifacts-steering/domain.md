# 契约束 `artifacts-steering` — 领域模型与不变量（支撑材料）

> 洋葱最内层。翻译自 `requirements/04-artifacts-steering.md`，不发挥。

## 一、实体与值对象

### `ArtifactRecord`（聚合根）

```
ArtifactRecord {
  artifactId:  string
  threadId:    string
  name:        string
  kind:        "pdf" | "docx" | "png" | "other"
  versions:    ArtifactVersionInfo[]   # 有序，创建顺序，不可变追加
}
```

一次工具调用产出文件类结果时创建一个新的 `ArtifactRecord`（`version=1`），而不是
仅作为一条聊天附件落库（R3 步骤 1）。

### `ArtifactVersionInfo`（值对象）

```
ArtifactVersionInfo {
  version:            int        # 单调递增，从 1 开始
  producedByRunId:    string     # 必须可追溯（R7）
  producedByStepId:   string     # 必须可追溯（R7）
  changeNote:         string
  storageKey:         string
}
```

### `Interjection`（中途插话，非持久聚合根，事件驱动）

```
Interjection {
  runId:            string
  interjectionId:   string
  text:             string
  receivedAt:       timestamptz
}
```

## 二、不变量

- **I-1 可追溯**：每个 Artifact 版本必须能明确追溯到产生它的 `runId`/`stepId`，
  不允许出现"不知道哪次执行产生的版本"（R7）。可断言：`ArtifactVersionInfo.
  producedByRunId`/`producedByStepId` 为必填非空字符串，schema 层面无法构造出
  缺失这两个字段的版本记录。
- **I-2 版本不可变**：旧版本一旦创建，其内容不再被改写；"继续修改"总是产生新版本
  而不是原地更新（R3 步骤 5）。可断言：`continueArtifact` 的输出永远是新
  `runId`，不存在任何操作接受 `version` 参数去覆写已存在版本的 `storageKey`。
- **I-3 失败不计入版本历史**：产出物生成失败时不创建内容为空/损坏的 Artifact
  版本，失败的尝试不计入版本历史（R4 E4）。可断言：`continueArtifact` 触发的 run
  若以 `failed` 终态结束，`ArtifactRecord.versions` 长度不变。
- **I-4 显式版本依赖**：`continueArtifact` 必须显式指定 `basedOnVersion`，不能
  默默使用最新版本代替（R4 E2）。可断言：`ContinueArtifactInput.basedOnVersion`
  为必填字段，且服务端按该字段查找对应版本内容作为上下文，找不到返回
  `ARTIFACT_VERSION_NOT_FOUND` 而非静默回退到最新版本。
- **I-5 插话不打断当前调用**：插话不得打断正在执行的工具调用，必须等它跑完/
  超时，只影响"下一步是否按原计划继续"（R4 E1）。可断言：`interject` 调用成功
  返回后，当前正在执行中的 `tool_call_start`/`tool_call_end` 事件对不受影响地
  正常配对完成。
- **I-6 插话非取消**：插话默认被当作对当前任务的调整，而非另起一个任务，除非
  用户明确表达"取消"（R7）。可断言：`interject` 不改变 `AgentKernelRunStatus`
  为终态，run 继续处于 `running`（或迁入 `awaiting_plan_confirmation`，若内核
  判断为方向性改变）。
- **I-7 running 态输入框可交互**：`running` 状态下用户输入框保持可交互
  （非 disabled），这是可直接断言的 UI 状态（R6 后置条件）。

## 三、待人类在签核时确认

- A2（插话内容与当前任务无关时提示"是否开始新任务"）——具体识别策略属于内核
  实现细节，本束契约的 `interject` 操作本身不携带任何"话题相关性"判断结果的
  返回字段，前端如何呈现这个边界处理，待人类在签核时确认是否需要契约层面补充
  一个响应字段（如 `possiblyOffTopic: boolean`）还是完全交给内核侧异步事件处理。
- E3（插话导致重新规划使已批准的"本 run 内都允许"授权失效范围产生歧义）——
  这条不变量涉及 `plan-permissions` 束的 `StandingToolGrant`（run 级授权）与本束
  `interject` 的交互，属于跨束不变量，**已记入待阶段一致性复核确认**，不在本束
  domain.md 单方面下结论。
