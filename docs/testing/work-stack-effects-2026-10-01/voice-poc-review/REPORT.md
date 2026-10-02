# 实时语音 POC 结构复查与技术验证

整合测试源版本：`c13426a18eabc09f7ed8412181fc254bfab0aae4`。日期：2026-10-01（北京时间）。真实供应方、麦克风端到端与 devapp 验收仍 BLOCKED；下面的真实 Node HTTP/WebSocket 使用明确的本地测试上游，不能证明实际音质或线上恢复。

## 结构与修复

- POC `36c3be7df807e84743e220e8e0eacca2abaafabd` 使用 `qwen3.8-omni-flash-realtime`。Chat 集成 `4b957826d2eb4b13e6ed62d1efa3896f4b499ca6` 复用同一 `openOmniConversation`、协议及 gateway，增加线程和角色授权/转写保存。
- 按用户要求固定 `REALTIME_CONVERSATION_MODEL`，部署文字模型、ASR 模型或旧 realtime model 环境覆盖不能更换该模型；endpoint/key 仍通过安全配置读取。
- 原语音只从目录名称/职责/标签拼指令，缺实际背景。现读取同租户当前已发布版本 instructions，冻结 agentVersionId，追加语音模式的工具边界；缺正文拒绝，通用模式保留。
- 启动缓冲音频实际发送后设置 audioSent，挂断可提交最后短句。反证旧实现漏 commit；新测试暂停上游握手，以 ping/pong 确认 gateway 已接收缓冲音频，再放行并验证提交/转写。
- 上游远端关闭先有界等待持久化链，再发 session.closed。成功时 turn.persisted 在 closed 前；持久化不返回时约2秒结束，不伪造保存确认。
- 共享客户端远端关闭、server session.closed、麦克风启动迟到和重复关闭释放捕获/播放器；保留正常挂断等待最后转写。

## 路由判断

本地明确 API WS 地址可绕过 Caddy；VM 同域地址依赖 `/chat/realtime-digital-human` 的实际 Upgrade 路由。历史 Chat 集成未加此路由，`68e1146c3` 已修复；当前 provision 和 deploy-readiness 都有精确路由及匿名401握手门，不能重复添加泛化 `/chat/*` 路由。源码存在不证明运行实例已部署。截图中的 connect-failed 发生在 HTTP Upgrade 阶段，不能由模型 ID 修复直接判定已解决。

## 证据与边界

- 整合树 gateway/session：34/34 PASS（gateway-34.log），固定模型的真实上游 URL 与 session.ready 均已断言。
- 整合树共享客户端：6/6 PASS（client-6.log），包含迟到 capture 与释放失败回归。
- 旧缓冲与远端落库顺序分别反证失败；旧客户端 remote close 反证失败。原复用日志被失败进程覆盖，已弃用，不作为通过证据。
- 真实 PostgreSQL 专项4/4 PASS（published-role-pg.log）：实际目录/身份/线程仓储验证已发布正文与版本、草稿隔离、旧会话冻结、新发布重开、跨租户拒绝；错误改读草稿反证1失败/3通过（draft-read-counterproof.log）。测试提交6ee661110，整合为7aaacde9d；非目录mock。初始夹具约束失败不算反证。完整 API typecheck/lint 和最新浏览器结果另记，不能由专项测试推出。
- 当前环境缺真实供应方凭据且不能访问 devapp；真实登录 Upgrade、收音/听音、七角色背景回答、打断、挂断刷新和重试均未完成。预握手时挂断不承诺保存尚未送达供应方的音频。
