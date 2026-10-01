# 固定候选 tag 治理变更审阅（#4919）

这是具体待审阅方案；本 PR 不创建 tag、不改变 GitHub environment/ruleset/变量、不安装主机入口、不切换生产。依赖 #4914 的准备先于审批行为。必须先合并并验证 dispatcher 后，候选才可冻结；旧 source 缺新版 dispatcher 不能继承 latest-main workflow。

## 最小治理变化

- `production-cn-promotion` 保留已有 required reviewers 和仅 main 的 branch policy，增加唯一 tag policy `cn-prepared-*`。
- `production-cn` 保留无第二次 reviewer、仅 main/main-cn 的 branch policies，增加同一个 tag policy。拒绝其它 branch/tag 通配符。
- 新增 active tag ruleset，include 精确为 `refs/tags/cn-prepared-*`，exclude 为空。update/deletion rules **没有任何 bypass actor**。即使创建者也不能重定向或删 tag。创建权限只继承现有 contents:write，不依赖未证明可安装的内建 App bypass；不新增 PAT/App/宽泛 bypass。
- helper 独立请求 `apps/github-actions` 获取原生 Deployment App ID，只用于核对实际 native deployment 来源；不作为 tag issuer 或 token 能力证明，不需要额外 repo variable。workflow token 固定 `${{ github.token }}`。
- 继续保留 main-cn required_deployments=production-cn-promotion、禁止删除、严格 fast-forward CAS；不改变为其它环境、不造 manual candidate Deployment、不取消审批。
- 通过受控 bootstrap 更新可信 promotion verifier。实际 Devapp 原始证据由本文受控签名生产者收集并由 CN root 验签 staging。全部准备用 root 私有文件、相同 attempt、实际 raw SHA；缺项返回 NOT_READY。

## API 最小权限清单

| 实际 API | 权限 | 写入面 |
|---|---|---|
| commit check-runs | checks:read | 无 |
| commit statuses | statuses:read | 无 |
| exact Devapp workflow run、environment/policy读取 | actions:read（promotion 保留既有 actions:write） | 本变化不新增 actions 写操作 |
| native deployments / deployment statuses | deployments:read | 无；不能写 successful 状态 |
| Git refs/annotated tags、规则集、提交对象/checkout | contents:read；候选 tag 创建和既有 main-cn CAS需要 contents:write | only tag creation / exact main-cn CAS；不更新/删tag |
| App metadata | public metadata read | 无 |

GitHub 返回权限不足或治理读不到时失败，不能以“配置存在”放行。治理 API 额外 repository-admin 可见性在实际仓库中需要证明；不增加不可表达的 administration 权限或换高权限 PAT 来绕过。若内建 token 无法读取必要治理，使用本文受控签名治理收据适配，不伪造 API PASS。

## 生效前验收与恢复

在非生产 fixture 仓库/环境执行（尚未完成）：真实 GitHub Actions token 创建候选 annotated tag成功；同 token 尝试 retarget/delete 均被GitHub拒绝；无 contents:write actor 不能创建；审批只能允许该固定 tag；真实 native Deployment.sha 与 source 相等，successful admission 的 log_url 归属同 run；main 前进后仍派发原tag并使用原prepared镜像。完整记录原环境/规则快照与恢复方案，审核后才应用生产规则。任何规则异常保持生产不变。

当前仅纯函数、真实本地Git和mocked GitHub observations 反证；未声称实际GitHub保护策略、root ownership、Devapp验收producer或生产发布通过。治理应用及任何实际发布仍由主协调者执行。

原生 Deployment creator 的真实协议是触发者 User，而非固定 github-actions[bot]。必须同时核对 Deployment 的 GitHub Actions App id/slug、current run/attempt 的 actor 或 triggering_actor 的精确 id/login、真实同 attempt 已完成成功的唯一 admit job 与 source SHA、最新成功 status 的 creator 和精确 job html_url。真实 status 的 App 字段可为 null；不能凭一个可伪造 URL 前缀接受手工 successful status。

## 创建权限的明确权衡

tag 是不可变源码定位符，不是准备收据或发布授权。普通 writer 可创建 tag，但缺 root 保护的 exact receipt/images/actual Devapp+CI、合法 main lineage、可信 dispatcher 和人工 native admission 一律 NOT_READY。不同 payload 预占同名 tag 会 fail closed，不会改写已存在 tag；必须使用新的受控 attempt 重新完成全流程。代价是具有已有仓库写权限者可造成名称抢占/拒绝服务；以创建专用 App/PAT 生态避免该 DOS 不符合最小发布目标。保留 update/deletion zero-bypass 与全部数据/身份门控。

参考：[GitHub rules 官方说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) 分别定义 creation/update/deletion 规则；目前内建 Actions App 不在实际组织安装清单，不能从 metadata 推断其 ruleset bypass 可用。

## 规则读取的真实权限边界

[GitHub Rules API](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset) 明确 `bypass_actors` 仅返回给对 ruleset 有写访问的调用者。Metadata read 可以读 ruleset，不保证看到 bypass 列表。字段缺失绝不能当成 `[]`；prepare/promotion 与非生产proof均返回 NOT_READY/失败。GITHUB_TOKEN 不提供 administration:write 工作流权限；若实际读取缺该字段，必须另行审阅受控 root-admin 治理收据适配，不扩大 token 或改用 PAT。Root-admin 配置读回证明实际 zero-bypass，不证明 workflow token 的读取可见性或 tag 写能力。下节实现该适配；实际 operator 权限、公钥、运行体配置仍需单独落地验收。

## 受控适配器（代码已实现；本 PR 不配置凭据或运行发布）

普通 promotion `${{ github.token }}` 保持原权限。独立 operator 使用受审阅安装的
`cn-controlled-evidence.mjs governance <source> <attempt> <output>` 收集治理 API 原始响应并签名。
这是只读操作，但 GitHub 要求该独立 operator 对规则拥有写可见性才能返回 bypass 列表；
凭据只进入该独立进程环境，不进入 receipt、不传给 workflow，也没有任何规则修改 API。
组织继承规则按其组织 owner 查询。缺 bypass 字段继续失败。

人类在 CN 配置 root:root 0600 的 `/etc/workspacex-cn/governance-signing.pem`（Ed25519）和
匹配固定公钥 `/etc/workspacex-cn/governance-public.pem`；Devapp 分别配置
`/etc/workspacex-devapp/evidence-signing.pem` 与 CN 上的 `/etc/workspacex-cn/devapp-evidence-public.pem`。
这两种独立签名身份不得互换。候选目录必须 root:root 0700。治理输出经受控传输放到
`/etc/workspacex-cn/candidate-configs/<source>/<attempt>/governance-evidence.json`，root:root 0600。
收据绑定 repository/source/attempt，最长一小时；过期重新采集，不改字段延期。

Devapp root operator 调用同一脚本 `devapp <source> <attempt> <output> <successful-run-id>`：
从 GitHub 下载 exact successful `real-model-chat-evidence` run 的唯一未过期 artifact，
校验 API archive digest，解析真实八条 browser assertion、thread、run-start、pageerror，
再实际 `docker inspect` 运行容器与 image 的 OCI revision。root 私有
`/etc/workspacex-devapp/runtime-evidence.json` 只声明四服务 container 名：
`{"containers":{"api":"...","web":"...","agent":"...","sandbox":"..."}}`。
每个容器必须 running、启动早于该 run、image revision 等于 source。现有非容器化
Devapp 或缺 OCI revision 无法通过，须先提供受审阅运行体身份渠道，不用 git checkout 代替。
签名原始 bundle 包含 run/artifact/archive/browser/runtime 全链，禁止手填 passed。
CN operator 将 bundle 以 root:root 0600 暂存后执行
`stage-devapp <source> <attempt> <signed-bundle-path>`；验固定公钥签名与 TTL 后，机械生成
`devapp-acceptance.json` 和 `devapp-evidence.bin`，使用 exclusive create 禁止覆盖。
promotion verifier 每次重新验签、重新导出 acceptance、核对原始字节 SHA，然后输出受控
治理 snapshot；helper 对其 source/attempt/TTL 与全部治理规则重新校验。缺配置均 NOT_READY。
Bootstrap 仅增加可信 helper 安装清单；本 PR 不执行安装、不创建密钥、不改变实际 token。

### Nonproduction token proof visibility

The nonproduction proof receipt has scope `actual-token-tag-behavior`. It always records `globalZeroBypassProven=false`: it proves this workflow token can create/update/delete an unprotected control and is denied protected update/deletion with exact readback. If `bypass_actors` is hidden, continuation requires the actual API field `current_user_can_bypass=never`; missing or other values fail closed. This field does not establish that every actor has no bypass. Explicit visible bypass actors still reject the proof.

Production admission continues to require the separate controlled administrator signed snapshot and live governance comparison for global zero bypass. The token behavior receipt is never a substitute for that gate and grants no production authorization. No administrator PAT is introduced.
