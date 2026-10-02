# Devapp 特权操作互斥与受控更新窗口

部署和可信脚本安装的目标互斥参数唯一权威是
[devapp-operation-policy.json](../devapp-operation-policy.json)。两份 workflow 的静态
concurrency 字面量是执行镜像，由 `devapp-operation-mutex.test.ts` 解析 YAML 校验；
不得按 SHA、ref、run 或 operation 分组，否则不同操作能同时写同一目标。

## 正式 GitHub 入口

`backend-gates.yml` 的 deploy job 与 `devapp-install-trusted-scripts.yml` 使用同一
repository-wide concurrency group。运行中操作不会被新请求取消；失败/超时及人工取消
仍按各入口原有流程处理，不能把“不主动取消”说成不会失败。

默认仅保留一个 pending 请求。**同一窗口只允许一个明确授权的请求在等待**，不要反复
点击 dispatch：新 pending 请求可能替换旧 pending 请求。先核查已有 run/job 的精确
source、状态和结果再决定下一步；本门不保证 FIFO，也不把排队时间算成安装执行时间。

1. 确认精确 source/文件包及必要人类审批已满足，各项原有 CI/环境 reviewer 门保持。
2. 从已审阅的 GitHub 入口提交一次操作并记录 run、job、attempt 和 source。
3. 等待共享组准入；queued/waiting 不是执行中，更不是成功。不要另开 ECS/SSH 路径抢写。
4. 操作内部仍须执行原权限、hash、备份、CAS、原子替换、后验和失败恢复门。
5. 根据实际 job 终态及目标后验验收。取消/超时不能标完成；未知结果只读回，不重复写入。

## 直接操作的限制

当前受审 `deploy.sh`/`deploy-gate.sh` 没有与安装器共享的主机 flock。
identity 安装器的 `/run/workspacex-devapp-identity-install.lock` **只锁安装器**。
runner idle 或 `/proc` 中没有 deploy PID 只能证明读取时刻，不会阻止读取之后启动的部署。
API/Web 的运行服务状态也不是部署互斥。

如需要已有 GitHub 入口以外的精确单文件修复，先建立并审批受控更新窗口：所有操作者
暂停 merge main、创建发布 tag、preview/安装 dispatch 及手动 deploy；只读核查所有可
触发 Devapp 部署的运行/等待任务，包括 gates 尚未完成而 deploy job 尚未出现的 main/tag
run。存在任一这类任务即不能宣称窗口成立，先等待其实际终态。再次核查进程、目标
hash/mode 和 guards 后才可执行已批准动作。这是协调约束，**不是主机原子互斥**；无法
控制所有触发者时拒绝直接安装，改用经过独立审阅且持有共享 GitHub 组的安装入口。

现有 trusted installer 的文件范围保持原状，不能因它现在共享组就假称它已支持 identity
模块的 CAS 更新。新模块安装入口和特权实现需独立审阅/授权；本修复不上传文件、不
安装、不重跑部署、不停止 workflow，也不改变运行服务或凭据。

## 回归入口

```bash
pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/vm/devapp-operation-mutex.test.ts
```

该门已由现有 `verify:harness:raw` 全量测试发现。覆盖原始 split group、逐入口错误分组、
动态 ref、开启取消、缺少字段、pending 参数漂移、installer job override 和重复 YAML key。
这证明仓库配置一致性；生产是否实际执行过仍须读取 GitHub job 和目标验收事实。
