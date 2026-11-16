# A4 成员文字讨论：迟回授权状态修复

2026-11-16 UTC。基线 `15ca37c4ddfe0ccf46c629baee9eeb4364b3b2e8`；独立分支 `worker/aidt-complete-member_text`。沿用用户批准的 B 范围，不修改待人类签核文件，不部署、不发布 GitHub、不改权限矩阵或后端契约。

## 实际发现与修改

原控制器会把每一个历史/话题响应的 `canWrite` 无条件写回。因此在历史或话题读取较慢时，频道的后续增量已经确认归档/撤权，旧响应仍可能重新开放编辑和重试；撤权情形还会重新展示旧请求返回的正文。后端写请求仍独立鉴权，但 UI 的可用状态与权限事实不一致。

为每个项目的内存状态增加访问限制版本。读取记录发起时的版本；只读响应、撤权或主频道读取失败会使在途旧请求失去恢复权限的资格，写入只读回执也建立同一边界。旧响应在当前仍可读时可以补充历史，不能恢复写权限；当前不可读时不合入正文。只有限制发生后发起的新读取，才可以重新确认访问和发送权限。项目、组织、身份与会话 token 的原有隔离保持；发送失败仍保留原文和原请求 ID。

没有新增 UI，继续使用现有 `TeamTextLiveConversation`、全局 launcher、原适配器与纯人类消息端点。没有调用 Agent/AI Chat 或更改教学模块。

## 先失败再修复

| 实际组件反例 | 修复前 | 修复后 |
| --- | --- | --- |
| 更早历史读取中，后续频道读取确认归档，旧可写历史响应迟到 | 编辑框错误恢复可写 | 保持归档只读，保留草稿，不能发送 |
| 更早历史读取中，后续频道读取确认移除/404，旧可写历史响应迟到 | 撤权后再次显示旧正文 | 正文保持隐藏，草稿保留且不能发送 |
| 话题可写读取较慢，后续频道读取确认归档 | 话题的归档提示消失，编辑恢复可写 | 真实根消息仍可读，话题保持只读 |
| 发送返回 `READ_ONLY_ROLE` 时更早历史仍在途 | 迟回历史重新开放失败消息的重试按钮 | 禁止重试；下一次新授权读取成功后，可用同一请求 ID 重试 |

[`before.log`](./before.log)：4 个新增反例全部失败，原有 21 条通过。运行工具为 Node 22.23.5 / pnpm 9.15。

[`after.log`](./after.log)：5 文件、55/55 通过，退出码 0。

```sh
WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web test \
  tests/ui/project-member-chat.test.tsx \
  tests/ui/project-member-chat-launcher.test.tsx \
  tests/live-project-member-chat.test.ts \
  tests/project-member-chat-navigation.test.ts \
  tests/ui/team-text-conversation.test.tsx
```

覆盖包含：关闭暂停/重开补拉、路由与选择项目保留、项目与身份隔离、未发送草稿、失去回执后的同 ID 重试、幂等冲突、离线恢复、旧话题和中断话题恢复、迟回显示名和话题摘要保护、IME、防止把人类消息送入 AI 端点。没有重复实现这些既有功能。

定向 ESLint 退出码 0（[`lint.log`](./lint.log)，成功无输出）；`git diff --check` 通过。root 统一 `./init.sh` 已确认退出 0；整体 typecheck/build 与原生浏览器验收由 root/QA 集成后执行。本 worker 没有启动数据库、API、Web 服务或独立 Docker 栈。

## 边界与待验收

- 新增反例使用实际 React 控制器与界面，但 HTTP/session 端口由测试替身控制延迟，不是新一次真实数据库、跨浏览器或课堂验收。
- 本次无视觉布局改动；不把 jsdom 结果称为真实浏览器或移动端布局验证。QA 继续使用原 global-member-chat、project-member-input/send 和真实回执锚点。
- 未发送草稿只在已认证页面会话内存中保留。关闭插件和应用内路由切换可保留；刷新、退出登录和浏览器重启后的未发送草稿恢复仍未实现。已保存消息的恢复继续使用真实后端。
- 未读数、read cursor、成员通知与已读回执在获准 B 设计中明确后置，本轮不实现，也不显示假红点、在线人数或阅读状态。
- 约五秒前台 HTTP 拉取继续沿用；30 人并发、真实网络断连延迟和真人课堂体验需要独立验收。语音、浏览器 P2P、访谈录音均未新增。
- 协调网关当前缺失，root 记录 harness tick 限制；没有代理 GitHub 可见性或签核门状态为已完成。

## 交叉审阅补修：旧错误不能撤销新授权

A1 只读审阅指出历史/话题的 catch 分支仍可能清除已恢复的新授权。实际复现：旧请求 V0 挂起 → 新频道读取角色只读，限制版本 V1 → 更新的读取恢复可写 → 旧请求最后返回 404。旧代码会清除频道访问并停止后续拉取。

[`stale-error-before.log`](./stale-error-before.log)：两个新反例失败，已有 25 条通过。补修让更早历史的过时错误直接退出；话题的过时错误只显示话题读取失败和局部重试，不清除新的频道授权，也不留下永久 loading。反例同时检查频道草稿、话题重试和后续五秒拉取继续。

另加两个反向用例：当前历史/话题请求的真实 404 仍清空可见内容并禁止发送，自己的未发送草稿保留。全套同范围验证见 [`stale-error-after.log`](./stale-error-after.log)：**59/59 通过、5 文件、退出 0**；定向 ESLint 与差异检查通过。A1 已只读核对补修 diff，未修改本 worker 文件。

## 对 A1 配置诊断的独立只读交叉检查

审阅目标：独立 worktree `aidt-complete-model_config` 的 `3c54f5ca8`，只读检查三个新脚本入口、字面量解析器、shell 安全标记与现有隔离链路。没有修改 A1 文件、读取真实凭据、联网或启动栈。

用 `/tmp` 单次合成文件和 Node22 执行四项额外检查，全部退出 0；临时文件已删除：

1. 通过真实 `pnpm real-model:doctor --model-env-file <含空格路径>` 调用。文件含合成模型字段、`touch` 命令和非模型部署字段；命令未执行，诊断不含合成密钥、endpoint、数据库 URL 或配置值。
2. 显式缺失文件即使继承完整合成模型三件套，也以 2 退出；输出 `fileStatus=missing`、`modelAcceptance=not_run`。
3. 含合成敏感 query 的 endpoint 被拒绝；输出不回显 URL、query 或密钥。
4. 只拦截唯一子进程启动，不模拟模型响应：safe smoke 保留调用者已有隔离 DB/API port/compose 值，不导入 CN 文件同名覆盖或 DATABASE_URL；设置 model-only 标记；精确调用现有 `with-test-isolation.ts → real-model-smoke.sh office`；合成子进程退出 19 原样传播。

未发现新增阻塞。这里只确认诊断与接线；没有验证实际模型连通、隔离栈启动或旧 smoke 下游所有日志的脱敏。旧非 safe loader 仍 source 配置、safe 入口不清洗调用者已导出的全部变量，这两点 A1 文档已有明确限制。

## 可接入现有原生验收的真实文字 helper

新增 `apps/web/e2e/support/aidt-member-text-acceptance.ts`，导出：

```ts
acceptAidtMemberText({
  page, projectId,
  request: (path, method, body) => existingAuthenticatedRequest(page, path, method, body),
  toStep: 1, // 可选；默认从S1去S2，其余步骤去S1，必须与当前步不同
  checkpoint: async (name) => { console.info(`[member-text] ${name}`); },
});
```

`request(path, "GET" | "POST", body?)` 必须绑定当前 Page 的真实已认证 HTTP 端口，返回 `{ status: number, data: unknown }`；可用原 native API helper 扩展支持 POST。不得传测试替身或安装 HTTP route fixture。

调用前提：已有真实本机服务、登录和当前身份可写的专用验收项目；当前 Page 位于 `/aidt/<projectId>?step=1..6`，当前频道没有未发送草稿和未关闭的话题。helper 不登录、不起栈、不改视窗、不调用 `page.goto`，仅点击既有桌面/移动阶段导航 Link。若前提不符直接失败，避免覆盖调用方的未发草稿。

流程：真实全局 UI 发主消息 → 频道留草稿 → 单层话题真实回复并留独立草稿 → 关闭插件 → 切本组另一步 → 重开并核对话题/两份草稿 → 真实 API 重放两个原请求并确认 `replayed=true` → 有界增量分页回读各 client ID 仅一条，话题端点再次回读实际根和回复，确认未发草稿没有进入服务器 → 通过现有 UI 清除 helper 自建草稿并关闭插件。

返回可序列化证据：`projectId/fromStep/toStep/root/reply/uniqueClientMessageCounts/exactRequestReplay/channelDraftRestored/topicDraftRestored/draftPersistenceScope/generationRequestPaths`。`checkpoint` 依次收到 `topic-restored`、`channel-restored`，默认建议仅记录 phase；需要截图时沿用调用方自身 output，不打印 token。页面最终位于目标步骤，插件关闭；调用方决定随后是否回到报告或重启服务。

UI POST 必须实际返回 200/201；还核对原生已提交且未过期的会话身份、UI 请求与当前会话 Bearer 的布尔一致性、服务端回执作者等于当前 userId。token 不返回、不输出，也不参与会把两边原值打印出来的断言。helper 临时监听原生消息/队列、Agent run 和 Design Chat 的 POST 路径，要求文字流程与阶段跳转没有发起这些生成请求，并在 finally 移除监听。它不把页面上的“已保存”标记单独作为服务器回执。

已执行、退出 0：此单文件的 `tsc --noEmit --skipLibCheck --target ES2022 --module esnext --moduleResolution bundler --esModuleInterop`、定向 ESLint、`git diff --check`。**本 worker 未调用 helper、未启动浏览器或重型 E2E**；这些断言的编写和编译不代表运行通过，真实执行结果必须由 root/A6 的原生验收另行记录。helper 验证同一已认证页面会话的未发草稿保留，不声称刷新或重启恢复草稿；服务器消息跨重启仍由原 native 测试独立证明。
