# ADR-124: Use main-cn as an automatic China production desired release ref

- 状态: Accepted
- 适用层：项目实现（专属）
- 日期: 2026-10-24（Asia/Shanghai）
- 来源：issue #5910；人类明确要求 main-cn 更新后自动部署、取消人工审批。

## 背景
原流程要求成功的 production-cn-promotion deployment 后才允许更新 main-cn，
并在该 environment 等待指定人的审批。这既阻止直接同步，也与“push 后自动部署”
形成循环依赖。用户明确选择自动部署，保留可执行的机器验证。

## 决策
main-cn 表示期望发布版本，不能作为运行体已经部署的证明。push 触发冻结 SHA 的
自动准备流程；完整准备成功后自动触发受保护标签上的晋级流程。允许发布的源码
仍须包含于 main，并满足现有源码、镜像、数据库、Devapp、运行基线及浏览器门禁。

移除人工 environment reviewer 和 main-cn 的推送前 required-deployments 要求，
保留分支删除/非快进保护、精确 branch/tag allowlist、不可变标签及原生 deployment
身份验证。配置先后顺序与失败边界见本次实施计划，不以普通 workflow 的绿色代替
真正的生产验收。实现契约以工作流和相应验证器为单一事实源。

## 后果
同步不再等待某个账号在线。自动触发仍可能因构建、权限、数据库或运行检查失败而
停止，因此 main-cn 与当前生产 SHA 在等待/失败期间允许不同；应读真实 deployment
和运行体证据判断生产状态。晋级不得再把 ref 已等于候选 SHA 当作已激活。

队列中候选被新的 main-cn 更新取代时，应在切流前拒绝过期目标。失败恢复的是原
运行体、镜像及流量指针，不自动覆盖用户随后推进的期望分支。

## 备选

保留推送前成功 deployment 会让 push-triggered deployment 永远无法开始。
直接重启 compose 则丢失准备、迁移和回滚门禁。采用现有准备与晋级能力改变触发
方式，避免另造不受这些验证约束的部署入口。
