# ADR-113: 个人设备配对与 Runner 协议——`personal-local` 从「本机」扩为「本人已配对的设备」

- 状态: Proposed（草稿，**需人类签核**；agent 不改本状态）
- 适用层：项目实现（专属）
- 日期: 2026-09-23
- 关联：issue #3910；需求文档 `docs/design/personal-device-collaboration-requirements.md`；
  `docs/research/super-instance-design.md` §3（联邦只主动连出）；ADR-112（本地版存储与同步）

## 背景

人类提出：用户有一台性能较好的个人电脑，跑着本地版 WorkSpaceX；希望手机（App，国内是
微信小程序）能和这台电脑协作——看对话、看运行、审批、**派任务给电脑执行**；将来同一机制
能把任务派到云端 VPC。

现状（2026-09-23 勘探，均为代码事实）：

1. 本地栈全部只绑回环：API `KERNEL_LISTEN_HOST=127.0.0.1`（`packages/local-runtime/src/config.ts:306`，
   读取处 `apps/api/src/main.ts:202-206`，注释明写「桌面端不得把会话令牌暴露给局域网」），
   Next 用 `-H 127.0.0.1`，PGlite / sandbox / ASR 同样绑 127.0.0.1。
2. `personal-local` 组织的契约语义是「数据永不离开本机」（`packages/contracts/src/identity.ts:38-59`），
   出站由 `apps/api/src/infrastructure/egress/local-egress-guard.ts` 拦截；唯一例外是人发起、
   有审计的导出（`apps/api/src/application/identity/export-to-organization.ts`）。
3. 执行器全是静态 env URL（`KERNEL_DEEP_AGENT_BASE_URL`、`KERNEL_SKILL_SANDBOX_BASE_URL` 等），
   没有执行器注册表、没有租约；agent run 在 API 进程内执行，事件总线是进程内的
   `InMemoryRunEventBus`（`kernel.module.ts:1773-1778`）。
4. 已有对「断线续传」友好的协议：`WS /agent-runs/:runId/events` 带 `lastKnownSeq` 重放
   （`apps/api/src/interface/ws/agent-run-events.gateway.ts`），bearer 令牌走 `Sec-WebSocket-Protocol`。
5. 没有任何手机端、推送、微信登录。

要让手机碰到电脑上的内容，第 2 条语义**必然**被触碰。所以先定语义，再谈实现。

## 决策（提案）

### D1. `personal-local` 的边界从「本机」扩为「本人已配对的设备」

- 「本人已配对的设备」= 同一账号下、经本机**当面扫码**配对、未被吊销的设备。
- 数据在**本人设备之间**流动不算「离开」；流向**任何第三方**（包括我们的中继、云端 Runner、
  其他人）仍然算离开，仍走 `export-to-organization` 那条「人发起 + 审计」的路。
- 默认关闭。用户在桌面端显式开启「允许手机连接」后才生效；关闭即吊销全部配对。

对照三条硬隔离（`LOCAL_ORG_GUARANTEES`，uc-0-5 R7，所属束 `phases/phase-00-shared-kernel/contracts/identity/`
已 `confirmed`）逐条说明本提案碰不碰：

| 保证 id | 本提案 | 说明 |
|---|---|---|
| `local-model-only` | **不碰** | 手机只是遥控器，模型调用仍在桌面本地发生。云 VPC Runner（D5）若跑云端模型，则该任务**不再属于** `personal-local` 语义，必须先走导出授权 |
| `no-mcp-egress` | **不碰** | 隧道不是 MCP，不新增任何 MCP 出网 |
| `no-shared-storage` | **措辞要改** | 中继信箱（D4）会暂存**密文**。提案把该条解释为「不以可读形式进入共享存储与跨组织索引」，并把这句改写进 `statement`——这是对已签核契约的变更，**必须人类在 identity 束重新签核** |
- `local-egress-guard` 增加一条放行：目的地是**已登记的中继地址**且载荷是 D3 定义的密文帧。
  其余出站规则不变。

### D2. 桌面只主动连出，本地服务继续只绑回环

- 桌面进程内新增「隧道客户端」，**主动**以 WSS 连到中继；中继把手机来的请求帧转给隧道客户端，
  由它在本机转发到 `127.0.0.1:3200`。
- 不开入站端口、不做 UPnP / 内网穿透、不改 `KERNEL_LISTEN_HOST`。这与联邦层「客户实例只主动
  连出」一致（`super-instance-design.md` §3.1）。
- **协议复用现有 API**：隧道承载的就是现有 HTTP 请求与 WS 帧，不另造一套手机专用 API；
  手机端只需要一个更小的界面，不需要更小的后端。

### D3. 中继只路由密文，看不到内容

- 配对时交换 X25519 公钥（二维码携带：桌面公钥、中继地址、一次性配对码、有效期）；之后每条
  会话用 Noise 风格握手派生会话密钥，帧级 AEAD 加密。
- 中继只知道：设备 ID、帧长度、时间。不知道：内容、URL 路径、令牌。
- 中继**不做同步、不做服务端授权过滤**——这正是 ADR-112「端到端加密与服务端同步相互矛盾，
  二选一」的那一刀：本方案选端到端加密，所以中继永远只是**传输**，授权仍由桌面上的 API + RLS 做。
- 手机拿到的是**设备级令牌**：可限权（例如只读 / 可派任务 / 可审批）、可单独吊销、登录时记录
  设备信息（复用 `interface/device-context.ts`）。

### D4. 离线派任务 = 中继上的密文信箱

- 电脑离线时，手机的「新建任务」帧以密文存入中继信箱（按目标设备分桶，TTL 默认 72 小时，
  上限条数），电脑上线后拉取、执行、确认删除。
- 推送只发**不含内容**的信号（「任务完成」「需要你审批」），手机点开后再经隧道取结果。

### D5. 抽象 Runner 协议，桌面是第一个 Runner，云 VPC 是第二个

Runner = 能领任务并执行 agent run 的执行位置。协议最小集：

| 动作 | 说明 |
|---|---|
| `register` | 声明 Runner ID、归属（本人 / 组织）、能力（模型、显存、工具、技能包） |
| `heartbeat` | 在线与负载 |
| `lease` | 领取任务，带租约到期时间；过期未续则任务回到可领状态 |
| `events` | 运行事件流，语义等同现有 run events（seq 单调、可重放） |
| `complete` | 交付结果 / 失败原因 |

- 云 VPC Runner 同样**只主动连出**。
- `personal-local` 的任务派给云 Runner = 数据离开本人设备，**逐次**明确授权并入审计（D1）。
- 租约与纯函数规则的实现先例：`packages/coord-brain`（本 ADR 只借模式，不复用该包——它属于
  不交付的内部运营平面）。

### D6. 中继必须可移植，国内部署在境内并用已备案域名

- 中继写成普通 Node 服务（可移植层），不依赖某一家云的原语（`architecture.md` 可移植性硬约束）。
- 国内部署到阿里云（`packages/cloud-deploy` 已支持），域名走 ICP 备案——微信小程序只能连后台
  白名单里的 HTTPS/WSS 域名；海外可另出 Cloudflare Durable Object 实现，两者协议一致。
- 微信 openid / unionid 属个人信息，按运营平面三层边界存境内；边缘层只放不可逆 ID。

## 不做什么（本 ADR 明确排除）

- 不做桌面 ↔ 云的**数据同步**（那是 ADR-112 的问题，结论仍是先导出/导入）。
- 不开放局域网直连（同一 Wi-Fi 下直连是以后的优化，不改变 D2 的默认）。
- 不做「别人远程控制我的电脑」：配对只限同一账号本人的设备；给他人看结果走现有分享/导出。

## 后果

正面：
- 手机协作不需要新的后端能力，只需要隧道 + 小界面；现有 run events 的续传能力直接复用。
- 桌面的安全面基本不变：没有入站端口，本地服务仍绑回环。
- Runner 协议让「在哪执行」成为可选项，云 VPC 是加一个 Runner，不是重写执行链。

负面 / 代价：
- 改了已签核的 identity 束里的产品承诺（`no-shared-storage` 的措辞 + 「本机」→「本人设备」），
  属于**签核后变更**，需人类在该束重新签核；代码侧的单源（`packages/contracts/src/identity.ts`）
  与界面上逐条列出的说明条要同批改，不许出现第二份表述。
- 新增一个必须常驻的服务（中继），且国内外各一份部署；中继可用性直接决定手机体验。
- 端到端加密意味着中继无法帮忙做任何内容级功能（搜索、预览、摘要），这些都只能在桌面做。
- 微信小程序的内容安全、生成式 AI 备案等合规要求**尚未核实**（见需求文档开放问题），可能反向
  约束 D3 的「中继看不到内容」。

## 我们什么情况下会改主意

- 若合规要求平台侧必须能审查小程序展示的内容，D3 需要为小程序通道另开「非端到端」模式——
  那时要重新评估是否值得做小程序，而不是悄悄降级加密。
- 若实测中继延迟 / 可用性无法支撑交互（例如审批往返 > 3 秒成为常态），优先做局域网直连与
  桌面侧预取，而不是把内容放到云上。
