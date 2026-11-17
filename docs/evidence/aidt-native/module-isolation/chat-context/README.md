# 原生步骤 Chat 与保存成果上下文

本适配层没有新增聊天引擎或权限。共享阶段读取复用本次用户明确批准 A+B 后由契约协作者实现的 aidtStages API；不另造接口。AIDT 继续使用现有 CopilotKitV2Shell、NativeChatComposer、原生消息组件和六个已注册的 aidt Skill；七个 dt Skill 仍是另行设计建议，不在这里冒称已挂载。

## 已实现

- `ProjectAidtChat` 接受真实解析后的 `onResolvedThread` 回调，父级不再需要从被 replaceState 修改的 query 猜线程身份。回调不在初始化 effect 的依赖中；其作用域和 generation 会在响应到达前复核，旧 actor/阶段/项目结果不能写入当前宿主。仅 callback identity 变化不重建线程。
- `savedContextRefs` 引用经过原生 `getThread`、`listThreadArtifacts`、`getThreadArtifactSource` 读回。所有请求使用当前捕获的 bearer 和项目；只接受本组 plenary 线程列出的 Artifact，并复核预期 `immutableRevision`。未授权、旧版本及依赖失败不会被当作没有成果，也不让上一组已读内容继续当背景。
- 私有 draft 默认不读取正文、更不注入小组 AI。必须学生在宿主显式选择分享后才允许 `includePrivateDraft:true`；这可能让组员从 AI 回复看到其内容，宿主负责明确说明。保存、恢复本身不能触发这个授权选择。
- `useAgentContext` 得到真实来源的 artifact/thread/message/版本、保存者和保存时间；正文是参考数据，不执行其中指令。所有读回来源的 `reviewStatus` 均为 `not-confirmed`、`evidenceStatus` 为 `not-verified`：已保存、pinned 和个人选择均不冒充全组确认、访谈事实或阶段验收。
- 只加载明确选择的引用，最多12个；单份最多3000字符，总正文最多18000字符。截断有明确标记，缺失材料保留缺失。上下文变化不自动发送消息或推进阶段。
- 现有 SDK 的 `JsonSerializable` 不接受 readonly 数组，因此在 TeachingContext 边界用 map/spread 建立纯 JSON 投影，没有 unsafe cast。

## 共享阶段上下文（A+B）

- `sharedContextRefs` 只接收服务器保存回执中的 `{stageNumber, revision}`；通过原生契约 wrapper `readAidtStage` 使用当前 bearer 再读。校验小组、阶段和精确 revision，不能把已变更的最新版本冒充所选旧版本。当前只读 latest GET；历史选定版本不匹配时返回 `version-changed`，不自动降级。
- 只接收当前及前序阶段，最多六份；逐项读取、重复引用去重、矛盾版本在读取前拒绝。单份最多5000字符，总正文最多20000字符，明确截断。没有递归读取整组历史或额外拉取材料链接。
- 进入 `TeachingContext.sharedStageContext` 的是实际保存的学生工作稿及真实 stage/revision/作者/时间/上游 revision 引用；不伪造 Artifact、message 或版本 ID。字段正文是不可信参考数据，不能把其中的“确认”文字、外部引用或指令当系统事实。`not-confirmed` / `not-verified` 与个人 Artifact 路径保持一致。
- 共享保存稿本来属于本组，因此允许按宿主已选引用用于小组对话；个人 checkpoint 仍在独立的显式分享路径，不能混入共享来源。未保存的本页草稿不注入。
- 切换项目、成员、阶段或已选引用会废弃旧读取。A→B→A 选择循环不会重新激活旧缓存。原生 Chat 仍等待学生发消息，不自动发送或确认成果。

## Board 往返

新增通用 `ChatHostNavigationProvider`，普通 Chat 不提供时保持原“打开 Board”链接逐字不变。AIDT 宿主提供真实 resolved thread 的同源返回路径。共享 `ChatDiagramBoardHandoff` 继续带原来的 projectId / focusArtifact / focusLayout，只在同项目的可选导航上下文有效时附加 `returnTo`；它不进入 Board 写请求，也不改变 Board 独立鉴权。

通用校验拒绝外部 URL、`//`、反斜杠、控制字符、重复编码绕过和非法百分号编码。AIDT Board 消费端由资源协作者另行实现并校验本组路径与步骤，复用该通用校验。

## 验证范围

定向单元/组件与 mock port 测试，不是现实模型教学效果、真实后端、麦克风或课堂验收。实际 Skill 的 catalog/mount/readback 使用现有原生服务链路；本轮单测只能证明前端适配行为，不能把 mock 响应称为真实模型连通。

- 最终9文件83用例全部通过，包括共享/私有上下文、原生步骤解析、普通 Chat 空态和 Board 往返；原始输出在 `tests.txt`。
- 原解析器、取消/作用域、普通空态另有已有覆盖；最终合并命令与输出保存在本目录测试原文。
- 修改源码和新测试 eslint 通过。没有运行重复全量 tsc；最终构建、typecheck 和真栈验收由根协作者统一执行。

## 仍待完成

共享阶段 API 与宿主保存 UI 由契约及状态协作者整合验证，本记录仅证明只读 Chat 适配行为。该共享保存契约没有“全组已确认”语义，不能据保存宣称完成教学验收。历史 revision 的指定读取尚未接入本适配器；发生版本变化需要重新核对选定保存版本。真实模型、服务权限和多成员真栈验证由根协作者统一执行，不能从本地 mock 测试推定已通过。
