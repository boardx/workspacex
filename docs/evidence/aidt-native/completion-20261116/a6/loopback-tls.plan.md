# 本机TLS受控回归计划

本轮仅零模型费用。真实Python/httpx向已获标准端口租约的127.0.0.1 TLS listener发HEAD，旧启动profile遗漏临时CA应验证失败，新restoreOwnerEnvironment继承同临时CA应HTTP200。TLS校验始终开启、retry0、timeout3秒；无用户CN/凭据/模型配置/DB/外部proxy或外部网络。

```mermaid
flowchart LR
 A["现有工具/端口租约核对"]:::tested --> B["临时CA+SAN及真实TLS对照"]:::tested --> C["监听/端口租约/私钥清理"]:::tested --> D["安全证据及边界"]:::tested
 classDef pending fill:#ddd,color:#222
 classDef active fill:#ffe08a,color:#222
 classDef done fill:#95d5a3,color:#222
 classDef tested fill:#baa4e8,color:#222
```

仅证明受控launch机制可以造成该类证书错误；不能事后证明S2实际底层cause。原失败、费用pending和预算占用保持。

## 实际结果

[机器记录](./loopback-tls-machine.json)、[真实对照与既有环境测试6/6](./loopback-tls-green.txt)、[scoped TS退出0](./loopback-tls-types.txt)、[loopback监听门退出0](./loopback-tls-listen-gate.txt)。不使用MockTransport或TLS校验关闭。

- 已存在的Python3.12.14/httpx0.28.1，OpenSSL3.5.7/Node22.23.5。
- 临时独立CA签127.0.0.1 SAN证书，服务端真实bind回环与标准全局端口租约47970；第二owner尝试同lease被拒绝。
- 旧base-only环境没有SSL_CERT_FILE，实际ssl.SSLCertVerificationError，服务端HEAD计数0。
- 实际restoreOwnerEnvironment继承同临时CA，httpx.HTTPTransport verify=True/trust_env=True/retries=0、timeout3秒；HEAD200/空body，服务端恰1条HEAD且无authorization/cookie/body。
- finally实际关闭listener、同port成功rebind再关闭、原lease释放、临时目录及CA/server私钥删除。若无法确认listener关闭则保留标准lease quarantine，不假释放。
- 第一轮[QA红日志](./loopback-tls-first-red.txt)保留：异常采集器只看__cause__，漏掉__context__中的SSL原型，误判反例；遍历两者后捕获真实SSLCertVerificationError。首红也已实际清理端口与私钥，没有模型/外部请求。

## 重现（仅本机TLS，无业务栈）

前提为已有Node/tsx、OpenSSL3和装有httpx的Python，不安装依赖、不读取用户CN/env/凭据，不恢复DB。替换解释器绝对路径即可：

```sh
AIDT_TLS_TEST_PYTHON=/absolute/path/to/existing/python \
  pnpm exec tsx --test scripts/tests/aidt-checkpoint-network-env-tls.test.ts \
  scripts/tests/aidt-checkpoint-network-env.test.mjs
```

本测试仅证明省略/保留调用者CA的启动环境可以造成/解决该受控证书错误。它没有重放S2、没有调用模型/SDK/DB或外网；不能将其追认为S2 actual根因，也不改变S2失败、补账占用和待结算财务状态。
