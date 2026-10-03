# 资产、协作与事务

## 提交与 undo

[undo](../../../../packages/whiteboard-core/src/undo.ts) 对 tracked origins、structural/compound history、
peer 冲突、删除恢复 receipt 做验证；不是裸 Y.UndoManager 的无条件撤回。
一个用户手势用一个 command batch，分开 geometry/content 会让一次擦除出现两步历史。
读取 `packages/whiteboard-core/tests/undo-conflict.test.ts` 和当前命令端口，不绕过 history。

`apps/web/components/whiteboard/live-board.tsx` 的 role/archived/phase 与 editor mutationBlocked
共同决定入口状态；服务端 ACL/RLS 仍是最终权限。测试 viewer、archived、锁定对象、
拖动中远端删对象、上传后目标消失、WebSocket 重连，不能只看 disabled 属性。
`apps/web/lib/whiteboard-provider.ts` 的 ACK/receipt 是同步证据，cloud spinner 不等于已持久化。
离线、pending、重连、拒绝应分别核对 API 和刷新，commentsReadable 与只读不能简单等同。

## 图片 vs 普通文件

本节保留旧资产候选的导航经验；在已核验的技能来源 `e72ede09` tree 中，
`board-image-upload-dialog.tsx`、`board-file-upload.ts`、`whiteboard-file.ts` 和 `file-assets.ts` 均存在。
使用时按当前 Git tree 重新核验下述完整路径；存在不代表已合 main 或 R07/R09 已验收，
仍需对应 PR/exact commit 与真实链路证据，不得按本节文字宣称上传链已交付。
下述权限/生命周期结论也需针对对应来源重新读实现和证据。

图片 UI：`apps/web/components/whiteboard/board-image-upload-dialog.tsx`；
会话图片：`apps/web/components/whiteboard/board-session-image-assets.ts`；
真实上传与 command 接入在 editor。local-session objectUrl 不是刷新后持久化证明。
统一 picker、drop、paste、URL、retry 的错误/忙碌状态；失败重试保留 placement/replace target。
await 上传之后重新读取对象及锁定状态，不使用打开弹窗时的 stale selectedObject。
区分本地选择、DOM ClipboardEvent 模拟和原生 OS clipboard；URL 输入存在不证明 HTTPS 成功链。

普通文件走 `apps/web/components/whiteboard/board-file-upload.ts`、
`packages/contracts/src/whiteboard-file.ts`、`apps/api/src/application/whiteboard/file-assets.ts`。
上传/下载校验 bytes/digest，tile 是 canonical 引用而不是图片 dataUrl；
权限顺序、加密存储/RLS/组织冻结读实际 API，前端 hash 不是恶意文件扫描。
当前普通文件 copy/backup/portable 链明确拒绝 file refs，不能把拒绝测试写成完整生命周期支持。
资产 GC root 保留范围读服务实现；移除 tile 不等于立刻删除 object store。
文件权限/资产架构同时使用 mod-asset-artifact，避免重复声明其权威规范。
