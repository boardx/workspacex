# 发布分支规则

| 入口 | 分支 | 环境 | 行为 |
| --- | --- | --- | --- |
| 合并 PR / push | develop | DevApp | 自动构建完整镜像、推送 ACR、拉取部署并验收；失败自动恢复应用镜像 |
| Run workflow | develop | DevApp | tag 留空重新构建；填写不可变 tag 则复用镜像 |
| Run workflow | main | CN | tag 留空重新构建；填写不可变 tag 则复用镜像 |
| 合并 PR / push | main | CN | 不自动发布；从 image-release 手动发布 |

`image-release.yml` 的环境默认 `auto`，以所选分支确定环境。手动指定与分支不符的环境会报 `BRANCH_ENVIRONMENT_MISMATCH`，不会部署。其他分支只能指定环境运行 build_only 诊断，不允许发布。

手动操作：Actions → image-release → Run workflow → 选择 main（CN）或 develop（DevApp）→ environment 保持 auto → service=all → 不勾选 build_only → tag 按需填写或留空。

旧 `backend-gates` 的源代码部署 job 已移除，CI 验证保留。旧 `deploy-cn-production` 不再监听 main-cn push，历史手动恢复入口保留。普通发布统一使用 image-release，无需 `WSX_IMAGE_RELEASE_ENABLED` 切换变量。工作流中的 build-only 诊断调用也遵守同一分支映射。

数据库结构变更继续走独立审查、备份和演练；初始化数据单独批准执行。镜像消费者检查实际 API/Agent SQL 清单，存在结构差异时拒绝直接切换，不自动迁移或跨环境复制数据。

本次分支对齐使用快进更新：先将规则 PR 合入 main，再令 develop 指向该次 main 提交。核对两条分支完整 SHA 相同，不重写历史、不使用强推。之后开发进入 develop，验证后再合入 main；分支不要求永久相同。

镜像 tag 统一为 `GitHub run ID-运行尝试次数`，例如 `40174623496-1`。首次运行结尾为 `-1`，重新运行全部任务会使用新的尝试次数。完整提交 SHA 独立保存在镜像 OCI revision、镜像集合清单和部署记录中；五个镜像的来源必须相同。

手动复用已构建镜像时，在 tag 输入框填写实际存在的短 tag（例如 `40174623496-1`），将跳过构建，直接拉取、验证并部署该集合。旧的 `完整 SHA-run ID-尝试次数` 仍兼容。已有旧镜像需要先发布经摘要核对的短别名，不能只截短名称就假定仓库中存在。

实际镜像 tag 从运行详情的 **Summary → Image tag** 或 deploy 日志的 `IMAGE_TAG` 复制。只重跑失败的 deploy job 不会重新构建镜像，因此仍使用第一次构建的 tag，例如 `运行ID-1`；只有重新构建全部任务才会生成新尝试次数的 tag。运行标题里的 build run 表示构建运行编号，不能当成已发布的镜像 tag。
