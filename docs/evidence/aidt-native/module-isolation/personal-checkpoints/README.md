# AIDT 个人服务器检查点适配

范围：复用现有 API，把学生本页结构化草稿显式另存为个人 Artifact draft，并由同一作者重新读取。**不是小组共享成果，不是组确认，不是阶段验收或原始研究证据。** 未增加 API、数据库、权限或全局 Artifact 行为；未使用 localStorage。

## 已核对的现有能力

- `artifact.operations.saveDraft.in` 只有 `artifactId/orgId/projectId/source/title`，没有提交内容的字段；`materialize-artifact.ts`、`pin-version.ts` 明记 D-2 缺口，不能把任意表单 JSON 塞入不存在的输入。
- `files.operations.uploadArtifact/uploadNewVersion` 声明了上传和 `expectedHeadVersion`，但当前 HTTP controllers 没有实现其 POST 路由，不能把契约声明当连通。`artifact-file-versions.controller.ts` 只有读取版本线的 GET。
- `chat.operations.createMessage` 必须 `agentId`，会持久化 human 并创建 queued run；不能拿它当静默表单保存或成员消息。
- 已有 `landAsArtifact` 接受真实 `messageId`、`mode:'draft'`、标题、`payloadRef`，并物化 `content.md` 与真实来源；`listThreadArtifacts`、`getThreadArtifactSource` 支持回读。
- `list-thread-artifacts.ts` 与 `get-thread-artifact-source.ts` 对 draft 严格按作者可见，没有项目管理员豁免；不能将项目 ID 相同解释成组共享。
- 该 POST 继承 Express 默认 100KiB 请求体限制（`main.ts` 明确其他特定端点才有更大 parser）。适配器按完整实际 JSON 请求体字节预检；不截断学生内容或自行扩大服务端容量。

## 模块接口

`features/aidt/lib/aidt-stage-persistence.ts` 导出：

- `loadAidtPersonalStageCheckpoints(scope,{threadId,stageId,signal?})`
- `saveAidtPersonalStageCheckpoint(scope,{threadId,messageId,stageId,draft,expectedHead,operationId,readOnly?,signal?})`
- `AidtPersonalStageCheckpoint/Scope/Head/LoadResult` 及带 `code/heads/checkpoint?/artifactId?` 的 `AidtPersonalCheckpointError`。

scope 显式携带 `orgId/userId/projectId/sessionToken`。会话令牌只用于请求，不写入文件。保存前读取真实项目概览和 Chat 详情，验证项目、归档、写能力及确实存在的 human 消息来源；不新建消息、不排队模型。关闭模块、身份不完整、取消或只读时拒绝后续写入。

## 保存和恢复规则

1. 文件格式 `workspacex.aidt.personal-stage` v1，明确 `contentOrigin:'student-authored-unverified'`、`recordKind:'working-draft-not-original-evidence'`、`visibility:'personal-draft'`。标题明确“学生填写的个人检查点”。
2. 既有 landing 底层 Artifact.source 固定为 `ai-generated`。这是端口物化分类，**不能据此断言检查点文字由模型生成**；更不能把 `hasSource`、Artifact mode 当作真实研究证据或小组批准。UI 与报告应采用上述学生草稿语义。
3. 每次新建独立 Artifact，**从不传已有 artifactId 追加或覆盖**；保存 JSON 中记录此前实际 Artifact ID 与 immutableRevision。读取保留全部检查点及父关系，无法解析、来源不符或作者不符时明确失败，不冒空态。
4. 草稿在请求开始前复制；保存中继续编辑的内容不被异步序列化。新发现卡所有字段均验证并保留；可兼容缺少 discoveryCards 的旧草稿；未知 JSON 扩展字段保留，不静默剥离。
5. 写前比对已读 head，写后读取内容、作者和来源并再次检查分支；**这不是服务器 CAS**。两窗口可同时创建两份检查点，适配器保留两份并报告冲突，不谎称一方原子胜出。
6. 多 head 仅支持读取/恢复和待核对提示，当前没有人工合并/消耗其他分支的操作。选择一条恢复不等于解决分叉，后续保存仍会阻止成功假象。真正组共享 CAS 由待签核服务契约处理。
7. 同 host、相同 operationId 与内容的在途调用合并；已完成但响应丢失可经读取 operationId 恢复。不是全局原子幂等：跨窗口同 op 仍可能有重复分支，不能自动当成一次成功。
8. 4xx 权限失败直接保留原错误；网络/服务异常、写后回读失败明确为结果未确认，带已知 Artifact 引用，不自动重发。取消后的迟到写入若已由服务接受，之后仍可重新读取；UI 必须用自身 actor/revision/epoch 隔离旧回执。

## 验证

```bash
PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-ui-v3-bin:$PATH \
WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web test tests/aidt-stage-persistence.test.ts
pnpm --filter web exec eslint features/aidt/lib/aidt-stage-persistence.ts tests/aidt-stage-persistence.test.ts
```

26/26 适配器单元测试通过，lint 与针对性 diff-check 退出0。覆盖关闭/缺身份/错误阶段、新发现卡与扩展字段往返、真实来源、旧版保留、陈旧 head/revision、并发分叉、同 op 合并、未知结果恢复、403、回读失败、取消及容量/非 JSON 内容拒绝。第一遍测试暴露“调用方直接传完整 checkpoint 作 expectedHead”与严格 head schema 的不匹配，已归一两字段修复并复测。

测试使用现有服务函数替身，没有数据库、对象存储、浏览器或多人真实端到端验收。日志为 `tests.txt`；局部测试启动 `2026-11-14 23:41:32 UTC`，耗时2.59秒。统一构建及真实 native E2E 由根 agent 另行执行，不在这里冒称通过。
