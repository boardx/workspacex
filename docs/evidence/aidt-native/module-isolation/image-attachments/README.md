# FR07 已发送图片附件复用

本适配器只读 WorkspaceX 原生 Chat，不上传附件、不创建消息、不触发 AI、不修改公共 Chat UI。

## 现成能力与实现

- `getThread(threadId, projectId, capturedBearer)` 校验同一项目、真实 thread、plenary 和无子组；其可见消息 ID 用于再次核对附件归属。
- `listThreadAttachments` 是原生 `GET /chat/threads/:threadId/attachments`，契约 `chatFileUpload.operations.listThreadAttachments.out`。原生后端先 `resolveVisibility`，再从 `chat_message_attachments` 读取 `message_id IS NOT NULL` 的已发送行。
- 新增 `loadAidtImageAttachments` 只保留原生白名单中的图片、真实可见消息关联和唯一附件；pending、孤立关联、非图片及无效响应不能成为候选。捕获本次 token；取消后不继续读取或把旧组结果显示出来。
- `AidtImageAttachmentPicker` 惰性读取，每批展示十二张，提供加载、真实空态、错误重试、只读和移除引用。选择器无上传能力，学生先通过原生聊天附件发送图片。图片继续使用现有 `useAuthedImageSrc` 取 blob，但仅取到 blob 不视为图片可用：必须实际 `img.onload` 且 naturalWidth/naturalHeight 大于零，才能选择或用于 PDF；`img.onerror` 清除 ready 源并禁选。
- 引用类型从 canonical `ImageAttachment` 通过 `z.infer` 派生，不重复定义契约结构。输出只有 `{attachmentId, threadId, name}`，不传外部 URL、blob URL 或 data URI 作为持久内容。固定 content 路径编码 opaque ID，拒绝 dot segment 和控制字符。
- `AidtImageAttachmentPreview` 对恢复引用再次校验本组 thread/message/list，并严格匹配附件 ID 与真实 filename 后才通过原生受鉴权 hook 读取字节。失败显示不可用，不替换为其他图片。可选 `onState` 将当前真实 blob 交给宿主打印；宿主必须随当前引用变化清理旧映射，blob 由原生 hook 撤销。
- 保存时由本次已获 A 契约授权的服务端 imageAttachment 校验作最终判定。前端选择不代表共享保存成功，更不代表材料是真实研究证据。

## 验证

`tests/aidt-image-attachments.test.ts` 六项、`tests/ui/aidt-image-attachment-picker.test.tsx` 十二项，加原生 `tests/ui/authed-image-state.test.tsx` 一项，共十九项通过。测试涵盖授权引用、真实消息关联、pending/孤立行过滤、跨组/私有/子组拒绝、失败与空态、取消、固定取图路径、只读、不可读图片禁选、切线程晚到隔离、恢复引用校验、原生 blob 预览、坏图片解码禁选/PDF源清除、旧线程加载事件不使新图ready，以及无SessionProvider不读取。

修复前新增两个坏图反例先在旧代码失败（2失败、8通过），日志在 `decode-before-fix.txt`；修复后十九项全部通过。最终命令输出保存在 `tests.txt`；修改源码与新测试 `eslint --max-warnings=0` 通过，输出在 `lint.txt`。这些是单元/组件与 mock port 测试，不能称为真实存储、多人权限或模型验收。没有运行重复全量 tsc。

StageOutput/draft 类型/readiness/PDF 打印由根协作者集成；服务器 imageAttachment 验证由契约协作者负责。本记录不把单独组件交付冒称完整 FR07 端到端已验收。
