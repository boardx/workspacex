# Chat → Board 图形往返

支持实际 Chat 的 Mermaid flowchart/sequence 与内置 persona 围栏。先通过 Chat 保存产物，再点击“插入 Board”。捕获的是当前 Fabric 模型，服务端从不可变产物字节验证逻辑源；不重新运行布局，不以截图代替节点。

- Flowchart 的圆角/终止/菱形/圆形映射 canonical ShapeContent；标签、边类型、绘制顺序保留。
- Persona 的真实入口是 ChatCanvasFabric。保留原生标题、字段、区域和便签及其样式/元数据。
- Sequence 的参与者标题和虚线 lifeline 是可持久化对象，消息用真实世界端点保持不同的 seqY。自调用保留回折路径。来源元数据保留参与者 IDs、顺序和版本。
- “图形源码”从当前 canonical 标签、几何和连接生成 Mermaid/Persona；缺失节点/混合来源拒绝导出。下载的 Markdown 可以重新作为 Chat/图形编辑源使用。Mermaid 源码格式本身不承载绝对坐标；保存绝对坐标请用标准 canonical/portable 导出。
- 网络失败重试保留 requestId、版本与完整请求；明确 CAS 冲突后用户重新确认才刷新版本。

## 权限

Chat source 搬运与 Chat source 重开共用 `canReadChatArtifactSource` → `resolveVisibility`。原线程不可见/已删除拒绝；draft 即使组织层允许也仅 landing 创建者可读。既有布局 binding 重放再次检查。迁移 `20260928000500_whiteboard_artifact_layout_variants.sql` 允许同一不可变版本保存多个逐次验证的 layout digest；不替换旧记录。普通非 Chat artifact 仍沿既有 artifact ACL；不从前端 URL 取源字节。

## 当前边界（不能宣称已覆盖）

仓库当前没有任何应用注册 `setTemplateBackgroundProvider`，默认 persona 是原生节点。非默认 `image` 节点、其它 Mermaid 家族明确拒绝，绝不把图片转成空矩形。新增 PDF 背景须另接经鉴权的来源与 Board asset 上传/引用，不能直接相信任意 src。

Sequence 消息目前用 canonical free endpoints，参与者关联在来源元数据中；整体图平移保持布局，但单独移动参与者不会动态调整消息端点。这需要后续扩展 lifeline attachment 契约。只有三图真实浏览器验收通过后才能声明本用户旅程通过。

## 主会话真实验收

`apps/web/e2e/support/chat-board-three-diagram-producer.ts` 导出 `produceChatBoardThreeDiagramEvidence`。输入已鉴权的真实 Page、API origin、已发布/已授权 board:read actor，以及三条真实持久化 assistant 图形页面（每页面首个对应图须是目标）。producer 会：

1. 每图创建独立 Board；真实 Chat 最大化→保存产物→关闭→插入 UI。
2. 捕获实际 UI handoff 请求，逐个比较 versioned canonical Read 的文本、世界几何、来源与关系；时序要求至少两条不同高度消息和真实 lifeline。
3. 打开 Board 后 reload，从产品“图形源码”入口比较当前 canonical 生成的完整源码。
4. 对相同 source version 的第二份真实布局发布/replay成功；同 requestId 改 layout 拒绝，改逻辑文字即使重新算 hash 仍拒绝。
5. 返回版本/对象数/hash/源代码证据；不伪造消息、artifact、模型回复或对象 API。

可执行 spec `chat-board-three-diagram.spec.ts` 接受 `BOARD_CHAT_FLOWCHART_URL`、`BOARD_CHAT_SEQUENCE_URL`、`BOARD_CHAT_PERSONA_URL`，使用 FULLSTACK_E2E 真实账号。对应 config 继承标准 fullstack 启动；不能拿另一个隔离库的 URL 当当前来源。主会话可以在同一栈的生成图旅程后直接调用 producer，或预先提供确实存在于该隔离栈的来源 URL。缺少来源会失败，不 skip。

只做 collect（不会启动浏览器/服务）：使用标准隔离端口环境后 `pnpm --dir apps/web exec playwright test --config=e2e/support/chat-board-three-diagram-fullstack.config.ts --list`。
