# 固定候选 tag 治理变更审阅（#4919）

这是具体待审阅方案；本 PR 不创建 tag、不改变 GitHub environment/ruleset/变量、不安装主机入口、不切换生产。依赖 #4914 的准备先于审批行为。必须先合并并验证 dispatcher 后，候选才可冻结；旧 source 缺新版 dispatcher 不能继承 latest-main workflow。

## 最小治理变化

- `production-cn-promotion` 保留已有 required reviewers 和仅 main 的 branch policy，增加唯一 tag policy `cn-prepared-*`。
- `production-cn` 保留无第二次 reviewer、仅 main/main-cn 的 branch policies，增加同一个 tag policy。拒绝其它 branch/tag 通配符。
- 新增两个 active tag rulesets，include 精确为 `refs/tags/cn-prepared-*`，exclude 为空。creation ruleset 仅允许预期 GitHub Actions Integration App bypass；独立 update/deletion ruleset **没有任何 bypass actor**。即使创建者也不能重定向或删 tag。未证明 GitHub Actions Integration 在当前仓库规则集中的实际授权路径可用，就 NOT_READY；不得为了消红改成 RepositoryRole、PAT 或所有人绕过。
- repo variable `CN_RELEASE_TAG_APP_ID` 保存经实际 GitHub App metadata 核实的 github-actions App 数字 ID（不是用户名/user ID）。helper 独立请求 `apps/github-actions` 核对，workflow token 固定 `${{ github.token }}`。该变量/metadata 不是 token 安装范围及规则 bypass 生效的证明。
- 继续保留 main-cn required_deployments=production-cn-promotion、禁止删除、严格 fast-forward CAS；不改变为其它环境、不造 manual candidate Deployment、不取消审批。
- 通过受控 bootstrap 更新可信 promotion verifier。根目录下实际 Devapp 原始证据与安全适配 JSON 由已有验收渠道收集/审阅并 staging；本 PR 不实现新的 Devapp 生产者。全部准备用 root 私有文件、相同 attempt、实际 raw SHA；缺项返回 NOT_READY。

## API 最小权限清单

| 实际 API | 权限 | 写入面 |
|---|---|---|
| commit check-runs | checks:read | 无 |
| commit statuses | statuses:read | 无 |
| exact Devapp workflow run、environment/policy读取 | actions:read（promotion 保留既有 actions:write） | 本变化不新增 actions 写操作 |
| native deployments / deployment statuses | deployments:read | 无；不能写 successful 状态 |
| Git refs/annotated tags、规则集、提交对象/checkout | contents:read；候选 tag 创建和既有 main-cn CAS需要 contents:write | only tag creation / exact main-cn CAS；不更新/删tag |
| App metadata | public metadata read | 无 |

GitHub 返回权限不足或治理读不到时失败，不能以“配置存在”放行。治理 API 额外 repository-admin 可见性在实际仓库中需要证明；不增加不可表达的 administration 权限或换高权限 PAT 来绕过。若内建 token 无法读取必要治理，受控只读治理收据适配需要新审阅，不伪造 API PASS。

## 生效前验收与恢复

在非生产 fixture 仓库/环境执行：真实 GitHub Actions token 创建候选 annotated tag成功；同 token 尝试 retarget/delete 均被GitHub拒绝；不允许 actor 创建 tag 被拒；审批只能允许该固定 tag；真实 native Deployment.sha 与 source 相等，successful admission 的 log_url 归属同 run；main 前进后仍派发原tag并使用原prepared镜像。完整记录原环境/规则快照与恢复方案，审核后才应用生产规则。任何规则异常保持生产不变。

当前仅纯函数、真实本地Git和mocked GitHub observations 反证；未声称实际GitHub保护策略、root ownership、Devapp验收producer或生产发布通过。治理应用及任何实际发布仍由主协调者执行。

原生 Deployment creator 的真实协议是触发者 User，而非固定 github-actions[bot]。必须同时核对 Deployment 的 GitHub Actions App id/slug、current run/attempt 的 actor 或 triggering_actor 的精确 id/login、真实同 attempt 已完成成功的唯一 admit job 与 source SHA、最新成功 status 的 creator 和精确 job html_url。真实 status 的 App 字段可为 null；不能凭一个可伪造 URL 前缀接受手工 successful status。
