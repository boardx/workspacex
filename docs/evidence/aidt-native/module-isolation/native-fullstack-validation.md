# 原生 AIDT 与成员文字协作全栈验证

2026-11-15 UTC：隔离 PostgreSQL、真实 API、干净 Next production build 和 Chromium 实跑 **3/3 通过，退出码 0**。浏览器断言耗时分别为共享阶段/报告 14.5 秒、成员文字 8.7 秒、原生六步 36.8 秒；包含构建的 Playwright 总耗时 6.2 分钟。没有部署、外部发布或生产权限修改。

该结果归属于报告 footer 与话题根摘要后续修正之前的候选。截图审查发现报告编辑区被 sticky 操作盖住、话题根上下文滚出可视区；产品正在作窄范围修正。最终候选需要重新构建/实测，不能沿用这一轮结果冒充最终 commit 已验收。

## 已执行的范围

| 用例 | 真实断言 |
| --- | --- |
| 小组阶段与报告 | 两个专用账号通过同源 HTTP 保存/回读；幂等重放；过期版本 409；UI 冲突保留本页输入，比较后保存新版；重新登录和另一成员刷新恢复；历史版本和前序引用；报告单独保存不夹带未保存的第六步编辑，第六步保存保留报告；跨组拒绝且不泄露正文；普通项目不取得 AIDT 阶段服务；归档只读；PG 精确回读 9 行阶段历史。 |
| 纯人类成员文字 | 普通项目也可使用；两个作者真实持久消息和单层话题；原生全局插件发送/回复；跨 Research 路由保留未发送草稿及沟通项目；10 条并发消息顺序唯一连续，并发同 ID 重试只存一条；同 ID 换正文 409；limit=1 增量不漏回复；旧话题晚到回复能通过主频道增量读到；跨组、非成员组织管理员、撤权后的旧会话拒绝；归档只读；PG 精确回读 15 行人类消息。 |
| 原生教学工作区 | 创建 general 项目并标记 AIDT、首页重新进入、普通项目列表隔离；375/768/1280 无横向溢出；复用原生 Chat UI/发送端口、真实持久人类和 Agent 消息；六步各自挂载对应 Skill/线程；个人检查点真实 Artifact draft 保存、immutable source 回读、刷新恢复及另一成员不可读；真实资源创建/关联/列表；复用录音 UI；资源读取失败、无权、并发线程选择和归档只读。 |

共享保存与成员文字测试在新建项目内查询了 `agent_runs` 和 `model_request_starts`，前后数量相同；没有调用模型来处理成员文字或保存成果。个人检查点保持仅创建者可见，不将其称为小组成果。

## 执行条件与证据

- 源码基线：`95bb37d728104a4d8888993724e985236e0f38ee` 加本轮集成工作区；执行时状态保存在 `/workspace/scratch/aidt-module-latest/native-source-checkpoint.json`。
- 标准隔离包装器：`.harness/scripts/with-test-isolation.ts`；最终栈 `wsx-ca7950e1aa5fe959ad5b`。全部服务只绑定 `127.0.0.1`。
- 真正使用的临时配置导入 canonical fullstack 配置，仅调整证据目录、1 worker 和 Next loopback bind；准备脚本复用匹配 pinned AGE commit 的已有本地镜像，未关闭 TLS。API、PG、对象存储、鉴权和持久化没有替身。
- 原生 Chat 的模型供应商为确定性的本地 upstream fixture。通过证明真实服务链路和保存，不证明教学回答质量或真实商业模型连通。
- 32 张原生截图已独立保存到 `/workspace/scratch/aidt-module-latest/verified-native-results/`；清单 `verified-native-manifest.json`，完整日志 `verified-native-console.log`。还有实际下载的 Markdown 草稿。
- PG 回读在测试内执行并断言；本轮 line reporter 没有把内联 `test.info.attach` 的 JSON 另存为文件，不能将其列为可下载 JSON 证据。
- 两个新迁移的实际表、FORCE RLS、tenant/org-freeze/archive 策略及 app-role grants 曾直接读回；元数据保存为 `migration-readback.json`。
- 退出后核验：该 Compose 项目没有剩余容器，自有 13 个服务端口均无监听。

## 发现和修复的测试问题

1. 个人检查点刷新后的测试过早展开旧 scope disclosure，thread 就绪重挂后收起。改为等待真实服务器读取完成后展开，并适配高级个人检查点入口；保留真实保存、回读和隐私断言。
2. 新测试 fixture 对创建项目使用完整 `createProject.out`，碰到既有 `KNOWN_CONTRACT_GAPS.P3`：生产明确不伪造 `provenanceEventId`。fixture helper 显式只排除这个已登记字段；新 A/B 响应继续按完整契约解析。没有修改既有契约或编造审计记录。
3. 独立协作 fixture 使用三个专用身份和独立组织，避免并发登录互踢或改变既有组织成员集合；仅在模块显式启用时创建。

## 在开发者本机复现

需先满足仓库 AGENTS 与 E2E SOP 的 Node/pnpm、Docker、依赖及镜像信任配置。新增仓库内配置保留 canonical fullstack 服务与种子，只限定本次用例并将 Next 绑定 loopback：

```bash
NEXT_PUBLIC_ENABLE_AIDT=1 ENABLE_AIDT_MODULE=1 \
NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT=1 ENABLE_PROJECT_MEMBER_CHAT=1 \
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter web exec playwright test \
  --config playwright.aidt-native.config.ts --project=seeded --workers=1
```

开关默认关闭，未显式开启时用例会跳过，不能把跳过称为验收通过。新配置的列出用例/静态检查与上述已完成的真实执行分别记录。

仓库内配置的首次 `--list` 在标准 isolation 包装器内成功列出 2 个文件、3 条用例，退出码 0；当次未启动 API/Web，也未执行断言。后续已为最终复验配置 list+JSON reporter、独立 `AIDT_E2E_OUTPUT_DIR`，并让两条 PG 证据先实际写文件再按 path 附加；这些改动待最终运行时确认文件真实存在。

## 仍未验收

没有实际麦克风采音、访谈同意采集流程、真实 ASR、实时语音房、真实图像生成服务或 30 人课堂负载验收。录音用例仅证明原生 UI 复用与真实个人转录资源读/关联，不将个人笔记绕作项目访谈证据。图像附件服务端归属校验另有局部测试，本轮没有以模拟附件宣称真实图像采集成功。

当前没有可调用的共享桌面/受控端口预览工具，因此没有经验证的用户可点击原生应用地址。上述 loopback 端口仅用于隔离测试，不能交付为外部链接；截图或自包含演示只可标为 UI 预览。视觉质量需课程负责人实际试用，不以测试全绿宣称已经达到客观 9 分。

## 最终精确候选复验

对 **`8f31b6fa4d94d74f0228df2367546b2782a06e27`** 的干净业务源码，使用仓库内 `playwright.aidt-native.config.ts` 完成新隔离栈、干净 production build 和全部断言：**3 passed / 0 skipped / 0 unexpected / 0 flaky，退出码 0**，Playwright 总耗时 6.7 分钟。共享阶段/报告 15.4 秒、成员文字 8.9 秒、原生六步 34.6 秒。

- 最终源码记录：`/workspace/scratch/aidt-module-latest/final-source-checkpoint.json`。
- JSON reporter：`/workspace/scratch/aidt-module-latest/final-candidate-results/results.json`；汇总 `/workspace/scratch/aidt-module-latest/final-candidate-manifest.json`；日志 `/workspace/scratch/aidt-module-latest/final-candidate-console.log`。
- **35 张最终原生截图**，均在唯一目录 `/workspace/scratch/aidt-module-latest/final-candidate-results/`，没有覆盖前轮证据。
- 真实文件 `shared-stage-pg-readback.json` 与 `member-chat-pg-readback.json` 分别保留 **9 行阶段历史、15 行人类消息**；各自前后 `runs=0`、`requests=0`。文件位于对应 `aidt-member-collaboration` 用例子目录，并作为 path 附件记入 JSON reporter。
- 报告编辑区在 375/1280 宽度均达到至少 80% 几何可见，25%/50%/75% 处真实命中 textarea，未被操作栏遮挡。
- 长话题回复滚到末尾后，375/1280 的固定根摘要与回复输入框同样真实可见且命中；根摘要保留正确消息 ID 和原文。
- 退出后直接查询 Docker 与监听端口，确认 `wsx-2444b5823d53bf93d9c0` 没有容器，全部 13 个自有服务端口无监听。实际回读 `/workspace/scratch/aidt-module-latest/final-candidate-cleanup.json`。

最终运行后仅交付证据文档发生变化；没有将后续未测业务源码与这次 commit 的通过结果混用。上述未验收范围仍适用，C 访谈录音另排。
