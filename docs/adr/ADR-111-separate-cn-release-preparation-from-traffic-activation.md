# ADR-111: Separate CN release preparation from traffic activation

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-14 07:12:36

## 背景
中国生产发布曾把跨境取码、镜像构建、配置生成、迁移、切流和业务验收放在同一条
长链里。任何慢步骤都延长变更窗口；任何中途失败都可能留下 `main-cn`、Nginx、容器
和数据库分别指向不同版本的状态。临时补入的 ASR、平台超级管理员、GitHub Issue
配置与 CopilotKit 3600 秒超时还可能在下一次全量发布时丢失。

发布既要在准备完成后五分钟内切换，也必须阻止已知产品回归进入生产。测试陈旧和
基础设施抖动可以有时限地豁免，但产品失败或未知失败不能由发布者主观跳过。

## 决策
发布分为两个不可混用的状态机：

1. `prepare` 固定 `origin/main` 的完整 SHA，评估代码和迁移差异，构建并核验 Web、API、
   Agent、Sandbox 四个带 OCI revision 的 immutable digest，渲染完整 canonical config，
   并完成不改流量的 shadow readiness/business 检查。结果写成私有、可过期的 prepared
   receipt，并绑定准备瞬间的四服务镜像、Compose runtime、Nginx 和 `main-cn` 指针哈希。
2. `activate` 只接受仍有效的 receipt。它重新计算基线并做 compare-and-swap，关闭新
   `main-cn` 只能指向该份已准备版本；激活随后关闭新的 CopilotKit POST，等待
   `queued`、`running`、`writeback_pending` 全部清零，再原子安装 Nginx、执行 canonical 8/8 和真实浏览器
   smoke。整个激活阶段共享 300 秒预算。
3. 切换后的任一失败恢复准备时捕获的四个 image ID、Compose runtime 和 Nginx。
   回滚无法证明时发布保持红色，不自动清锁或宣称成功。
4. 所有 gate 必须是 `passed` 或带分类的失败，不存在 `skipped`。只有 `stale-test` 和
   `infrastructure` 可豁免，且必须有 GitHub issue、证据 SHA-256、owner 和未过期时间；
   `product` 与 `unknown` 永远阻断。
5. canonical config 必须包含 `asrProfile`、`platformSuperuserEmails`、
   `githubIssueProfile` 的 secret reference；Nginx exact/prefix 两条 CopilotKit location
   均固定 read/send timeout 3600 秒。

## 后果
构建、下载和大部分验证退出切流窗口；准备可以安全重试，而激活输入变成不可变证据。
基线 CAS 阻止运维热修被无意覆盖，统一预算使“五分钟”可机械验收，失败分类也不再靠
口头判断。

代价是发布流水线必须在晋升 `main-cn` 前生成完整 receipt，并维护一个可信浏览器执行
环境。激活时会短暂拒绝新的 CopilotKit POST 以完成 drain；已有连接由 Nginx graceful
reload 保持。数据库破坏性迁移仍需另行设计 expand/contract 或维护窗口，本决策不会把
它伪装成可回滚的普通发布。

## 未采用方案

- 继续由 `main-cn` push 同时构建和部署：跨境与构建时延仍占用故障窗口。
- 仅按 Git SHA 判断基线：生产可能有单服务热修，同一 SHA 不能描述真实四镜像状态。
- 对所有失败允许人工 skip：无法区分测试设施问题和用户可见回归，会重复把已知 P0
  带入生产。
