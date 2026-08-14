# 个人转录历史管理 · contract delta

Status: proposed; human signoff required.

本文件只定义相对已确认 `personal-realtime-transcription` 束的增量。未列出的实时 ASR、个人可见性、正文展示、复制与编辑契约全部保持不变。

## 1. HTTP 契约

所有操作继续要求当前 actor，并以 `orgId + ownerUserId` 隔离；非 owner 与不存在统一返回 `TRANSCRIPTION_NOT_FOUND`。

### 1.1 查询真实标签

`GET /recording/realtime-asr/tags`

```ts
type ListPersonalTranscriptionTagsResponse = {
  tags: string[];
};
```

响应是当前用户全部个人转录的非空标签去重集合，不受列表搜索、标签筛选、排序和分页影响。服务端不返回其他用户的标签；客户端负责稳定展示排序。

### 1.2 修改名称与标签

`PATCH /recording/realtime-asr/sessions/:sessionId`

```ts
type UpdatePersonalTranscriptionMetadataRequest = {
  name: string;       // trim 后 1..100
  tags: string[];     // trim + 去重，0..5；每项 1..20
};
```

成功返回更新后的 `PersonalTranscriptionSummary`。仅允许更新 `name`、`tags`、`updatedAt`；不得更新 owner、组织、正文、capture 或用量。

### 1.3 永久删除

`DELETE /recording/realtime-asr/sessions/:sessionId`

```ts
type DeletePersonalTranscriptionResponse = { deleted: true };
```

删除成功后，同一 `sessionId` 的列表、详情、ticket、修改与再次删除均返回不存在。

## 2. 活动 capture 门禁

修改和删除前，服务端在同一事务锁定 `personal_transcriptions` 行并检查其 capture。存在 `starting`、`recording` 或 `stopping` capture 时返回：

```json
{ "code": "CAPTURE_ALREADY_ACTIVE", "message": "当前转录仍在录音或收尾" }
```

错误不得修改任何元数据或内容。客户端显示稳定错误并保留卡片。

## 3. 删除事务与数据边界

确认删除后，服务端在一个事务中：

1. 锁定并验证个人文档 owner/org；
2. 拒绝活动 capture；
3. 删除该文档的 `recording_sessions`，由级联删除 tracks、segments 与 tickets；
4. 删除 `personal_transcriptions`；
5. 提交后返回 `{ deleted: true }`。

`realtime_asr_usage_events` 是内容无关的计费审计，必须保留。数据库迁移解除其对 capture 的级联外键，但保留不可逆标识、actor/org、模型、时长与计费秒数；用量表不得新增正文、名称或标签副本。

## 4. UI 状态契约

1. 标签筛选项 = `全部标签` + tags API 的真实集合；不得混入固定示例。
2. 修改弹窗预填服务端值；保存成功后重新读取列表与标签集合。
3. 删除弹窗在确认前不调用 API；成功后重新读取列表与标签集合。
4. 当前筛选标签不再存在时重置为 `全部标签`。
5. 请求失败不乐观移除卡片，允许用户重试。

## 5. 兼容与安全

- 不改变 `PersonalTranscriptionDetail` 的正文单一事实源：正文仍来自 `recording_segments`。
- 不改变实时 WebSocket 事件、ticket 与 Provider 配置。
- 删除端点不接受 owner/org 参数，全部取自认证 actor。
- 日志不得输出正文；审计仅记录 operation、sessionId、actor、org 与结果。
