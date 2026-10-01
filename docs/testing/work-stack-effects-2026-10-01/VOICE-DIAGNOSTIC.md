# 实时通话有界诊断（#4869）

目标：定位 devapp 实时通话的握手失败，避免把未验证的部署状态或文字模型凭据能力当作事实。

## 已验证与未验证

- 基线：`68e1146c3` 已包含 #4854 的 Caddy 路由恢复代码。
- `live-omni-conversation.ts` 的“实时通话连接失败，请检查网络后重试”来自等待 WebSocket open 时的 error。配置缺失则在握手成功后由 gateway 返回 `session.error / NOT_CONFIGURED`；二者需要分别定位。
- 实际配置读取器已以合成值验证三种情况：maas 文字模型地址推导 realtime 地址但不借用文字密钥；显式其它语音地址不借用文字密钥；显式语音密钥被读取。日志：`/tmp/voice-config-reader-evidence.log`。无网络连接、无真实凭据。
- `workspaceRealtimeUrl` 仅接受 hostname 后缀 `.maas.aliyuncs.com`，保留 hostname 和端口，转换协议为 wss、路径为 `/api-ws/v1/realtime`，清除 query/hash。
- 地址同域不能证明文字模型密钥具备实时语音权限。仓库无该权限契约；既有 W14 音频验收记录明确不假定文字密钥授予 ASR。故保持显式语音配置，不新增 `KERNEL_MODEL_API_KEY` 回退。
- 已运行现有路由恢复测试，5/5 通过；验证真实 shell 文件修改/幂等/校验失败/回滚行为，Caddy 与 systemctl 是 doubles，不证明线上路由已生效。
- 当前环境没有 devapp 凭据，出站代理拒绝 devapp 连接；未取得线上 HTTP 握手状态、API 或 Caddy 日志，根因未确认。

## 最小证据与判读

浏览器测试只记录 WS 路径、响应状态、非敏感错误 reason、时间。不得记录 Sec-WebSocket-Protocol、Authorization、cookie、token 或私人对话标识。

| 观察 | 下一步 |
| --- | --- |
| 握手 401 | 核对会话有效期与服务端 principal resolve；勿公开认证值 |
| 握手 404 或普通 200 | 核对 `/chat/realtime-digital-human` 是否实际由 Caddy 转发到 API |
| 握手 502 | 核对 API 监听端口及进程就绪 |
| 握手 503 | 检查 principal resolver 的内部失败；脱敏日志 |
| 101 后 NOT_CONFIGURED | 核对显式语音 URL/key 是否存在，仅输出存在性 |
| 101 后 AGENT_UNAVAILABLE / THREAD_UNAVAILABLE | 检查服务端数字人和线程授权，不放宽权限 |
| 101 后 UPSTREAM_FAILED | 核对供应商 realtime 模型权限、地址与上游错误；脱敏日志 |
| 101 后 session.ready | 验证实际双向声音、打断、挂断后的转写保存 |

## 部署诊断边界

`deploy.sh` source 的是 `/usr/local/lib/workspacex-deploy-readiness.sh` 的 root 副本。main 的文件变化不会自动证明该副本更新。部署负责人应检查 `devapp-install-trusted-scripts` workflow 的 main SHA 与独立 sha256 复核，再检查部署日志中的 route repair 和 Caddy reload。不要从未合并分支安装 root 脚本。

此文档不触发部署，不修改运行时配置，不假定已经修复。完成标准为线上握手证据、session.ready 和真实声音/保存验证全部具备。

## 执行计划状态

```mermaid
flowchart LR
  A[源码和凭据契约检查] --> B[实际配置读取断言]
  B --> C[线上握手与通话验证]
  classDef tested fill:#EDE9FE,stroke:#7C3AED,color:#3B0764;
  classDef blocked fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D;
  class A,B tested;
  class C blocked;
```

阻塞：当前环境缺少线上访问与部署凭据；继续由有浏览器访问的测试会话取得上述最小证据。

## API 本地 WebSocket 验证补充

运行以下命令（不是浏览器 E2E，无 PostgreSQL、无供应商连接）：

```sh
PATH=/tmp/workstack-bin:$PATH COREPACK_HOME=/tmp/workstack-corepack pnpm exec vitest run --config .harness/vitest.config.ts apps/api/tests/chat/realtime-digital-human-gateway.test.ts apps/api/tests/chat/realtime-voice-session.test.ts
```

结果 29/29 通过，日志 `/tmp/voice-api-gateway-tests.log`。覆盖实际 HTTP/WS gateway、缺 bearer/无效 token、服务器角色指令、非法 frame、不可用角色与线程、未配置、上游错误、中文本地上游、转写与挂断保存。角色 service 使用假端口，未验证线上数据库状态。

额外合成握手探针 `/tmp/voice-upgrade-surfaces.mts` 把 production 的六个 upgrade surfaces 依 `main.ts` 顺序挂到同一实际 Node HTTP server。缺 bearer 为 401 且不调用 principal，无效 bearer 为 401，resolver 异常为 503，有效 bearer 为 101，bearer 在其它子协议后仍为 101；五项全部通过，日志 `/tmp/voice-upgrade-surfaces.log`。不匹配的其它 surfaces 没有拒绝本路由；每个带 bearer 的请求仅调用一次 principal。依赖为合成值，语音配置刻意缺失以禁止任何外部上游连接。所有 server 均已关闭，未启动 Docker 栈。

未建立 API 握手代码缺陷反证，因此未修改运行时。上述本地通过不能替代 devapp 握手、真实声音与部署状态证据。

## 部署就绪门修复

旧 `run_post_restart_smoke` 的本地 API/Web 健康与 private-probe 隐藏检查无法发现 public voice WS 被误代理。六项新增断言在旧实现上全部失败，反证日志 `/tmp/voice-readiness-counterproof.log`。

现在在既有可信 helper 的 `run_post_restart_smoke` 接入匿名 RFC6455 Upgrade 探针。真实公网调用使用 HTTPS 固定语音路径，connect timeout 2 秒 / 总计 5 秒，不读取 curlrc，不带 token/cookie，不跟随重定向，不关闭 TLS 校验；只有 curl 成功且 HTTP 401 才通过，200/404/502/101/000 和连接错误均失败并进入既有脱敏诊断。拒绝 101 避免把匿名开放语音当作就绪。

修复后相关三文件测试 38/38 通过（`/tmp/voice-readiness-tests.log`），含实际 production gateway + 实际 curl 返回 401 的成功路径，以及拿掉 gateway 路由后真实 HTTP 404 的失败路径。shell 语法和 diff 空白检查通过。部署与 CD wrapper 原本都调用同一 helper，无新增 root 安装文件或额外调用入口；仍需要可信脚本安装流程更新线上副本。此探针验证匿名路由/拒绝信号，无法证明供应商可用，且其它上游/WAF 返回 401 仍需部署日志或已认证浏览器验证作进一步鉴别。
