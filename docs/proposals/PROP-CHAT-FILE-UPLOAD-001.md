# Chat 文件上传 / 附件——契约草案 + 待签材料（PROP-CHAT-FILE-UPLOAD-001）

> **状态：设计 + 契约草案，待 design-signoff（人类）。** 人类 2026-08-11 亲口点名要文件上传
> （「期间要有文件上传的支持，上传各种文件」），V9 从「待签疑虑」转为「方向已确认、待做」。
> agent **不改 signoff status**，只备待签材料；coord-main 主持签核流程（按 agent-instructions
> 先例：人类逐字裁决 + agent 代抄留档）。
>
> ⚠ 文件与 context engine 强耦合：**上传的文件内容进的是 context engine 的 L3 检索层**
> （见 `PROP-CHAT-CONTEXT-ENGINE-001.md` §4.4），所以 V9 的「文件进 context」这一段必须和
> V10 一起设计，不能各做各的。

## 1. 现状（实测 origin/main）——三件套全缺

- **数据模型**：`chat_messages`（`0021-f108-chat-visibility.sql`）**无附件列**，body 是纯文本。
- **上传 UI**：`components/chat/` 全域 grep `type="file"`/dropzone/onDrop/attachment/onPaste **零命中**。
- **注入路径**：无任何把附件内容送进 `ModelCallInput` 的代码。
- 仓库里已有的对象存储能力在**别的域**（`application/files/download-ports.ts` 等 files/interview 域），
  chat 未接。

## 2. 契约草案（待签，按 ADR-023 契约先行 / ADR-020 单源）

### 2.1 数据模型（新表 or 新列——建议新表）
建议新表 `chat_message_attachments`（一条消息可挂多附件；不往 `chat_messages` 塞 jsonb，
避免消息行膨胀 + 便于按附件做权限/生命周期）：

| 列 | 类型 | 说明 |
|---|---|---|
| id | text PK | 附件 id |
| org_id | text | 组织隔离（同 chat_messages） |
| message_id | text FK → chat_messages | 归属消息 |
| storage_ref | text | 对象存储引用（复用 files 域的存储，不新造） |
| filename | text | 原始文件名 |
| mime | text | MIME 类型 |
| bytes | bigint | 大小（用于配额/预算） |
| extracted_ref | text nullable | 抽取出的可检索文本/OCR 结果的存储引用（进 L3 检索层用），null=未抽取 |
| created_at | timestamptz | |

→ 新 migration + 契约类型（`packages/contracts/src/chat.ts` 加附件形状）→ **design-signoff**。

### 2.2 上传端点
建议独立操作 `POST /chat/threads/:threadId/attachments`（multipart），与发消息解耦
（先上传拿到 attachment id，再把 id 挂到消息上发送）。→ 契约新操作 → **design-signoff**。
- 权限：复用线程可见性/写能力判定（`resolveVisibility` / `capabilitiesFor`）——个人线程作者可传，
  观察者不可传（与 land-as-artifact 同一条写权规则）。
- 配额/类型白名单：大小上限 + 允许的 MIME 白名单（防滥用），值待人类定。

### 2.3 composer UI（纯前端，但依赖 2.1/2.2 的真实后端）
📎 按钮 + 拖拽区 + 附件预览 + 移除。**硬约束**：没有 2.1/2.2 的真实后端前，**不做假上传 UI**
（本仓「无真实数据支撑的能力不做假 UI」红线）——UI 与后端同一批签核、同一批落地。

### 2.4 文件内容进 context（与 V10 L3 同一设计）
上传→抽取文本/OCR（`extracted_ref`）→ 进 context engine 的 **L3 检索召回层**
（`PROP-CHAT-CONTEXT-ENGINE-001.md` §4.4）。
- 大文件不整篇塞进 `ModelCallInput`（会瞬间撑爆预算，正是人类担心的「context window 超负荷」）——
  而是**按相关性检索召回片段**，这正是 context-pack 引擎的用途。
- 抽取管线（PDF/图片/文本各自的 extractor）是独立工作量，建议分期：先落「上传 + 存储 + 列表/预览」，
  再落「抽取 + 进 L3 检索」。
- `ModelCallPort` 契约不动（裁决 A 条件）：文件内容以检索片段形式进 history 组装，不改端口。

## 3. 分期建议（降低单次签核面）

```
V9-a 上传骨架：新表 + 上传端点 + composer UI + 附件列表/预览（存得下、看得见，先不进 context）
   └─ 契约（附件表 + 上传操作）+ UI → design-signoff（一束）
V9-b 文件进 context：抽取管线 + 进 L3 检索召回（与 V10 L3 同批）
   └─ 依赖 V10 的 context-pack 接线 + L3 层就位
```

## 4. 需要人类 / coord-main 的
- **design-signoff（人类）**：2.1 附件表 migration + 2.2 上传端点契约 + 2.3 UI（按 ADR-023 一束签三件）。
- **人类定值**：大小上限、MIME 白名单、每线程/每消息附件数上限、保留策略。
- **coord-main**：V9-b 动 execute-run.ts 组装窗口（与 V10 同批）+ 分期切分确认。

## 5. 我可能没覆盖到的
- 抽取管线（PDF/OCR/表格）的具体实现与依赖（可能引入新的服务端库），本文只到「有 `extracted_ref`
  这一层」，不含 extractor 选型。
- 多模态直传（图片直接进多模态模型 vs 先 OCR 成文本）——取决于 devapp 配置的模型是否多模态，
  待确认后再定 L3 对图片的处理。

---

*本文档由 dev-chat-e2e worker 2026-08-11 整理，契约草案待人类签核，agent 不改 status。*
