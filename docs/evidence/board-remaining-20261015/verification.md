# 剩余8项与 #5666：实际验收记录

2026-10-15。Issue #5764、#5666。状态：**部分通过，不能合并**。子智能体只开发；以下测试由 root 执行。

源码起点与最新已核对 origin/main：`a4346771468f33eb13e25f836c9e74b06f44cba4`。
开发分支：`codex/board-remaining-acceptance-20261015`；独立开发与验收 worktree，未重置主工作区。
最新实际浏览器待测 SHA：`3aae0186e7f7ed3ada93ba2a8c824b25b88444a9`。后续仅记录证据的提交不是另一个已测试运行实例。

| 原8项 | 最新实际结果 |
| --- | --- |
| 15 layout commands converge and undo | PASS |
| Alt-drag duplicates ActiveSelection, converges and undoes | PASS |
| pointer snap guide converges and undoes | PASS |
| smart preview cancel apply undo CAS and reload | PASS |
| visual acceptance: compact selection in three viewports | PASS；真实1440/1280/1024视口几何检查，不等于人工视觉签核 |
| brainstorm input creates twenty connected ideas and one-operation bulk undo | PASS |
| real owner publishes, anonymous friends read on phone/desktop, then owner revokes | PASS |
| inbox：直接提交后自动导航并打开drawer | NOT_RUN；仍fixme，等待已有签核冲突的产品裁决 |

#5666：create/rebind × fast/slow/cancel/lock/release-lock/release-delete 共12项真实浏览器 PASS。快速路径另含24次普通稳定目标快速释放；保留一次真实登录、实际actor、一个update/ACK、seq+1、服务端canonical端点、另一位独立登录editor和双端刷新。普通稳定目标历史主诉未声称已经独立复现；确认并修复的是旧候选失效时取消有效新目标的release竞态，以及重叠失效候选抢占live目标。

实际产品修复还包括工具条父容器resize与keyed toolbar替换后的重新测量；原屏内边界断言未放宽。Survey的完整回归发现一次采到Button颜色过渡帧，现等待同一次观察中的精确最终颜色，原值、动画和默认超时不变。

## 最新补充浏览器命令

在 `/private/tmp/wsx-board-remaining-verify-20261015`，Docker环境指向本机socket与专门配置目录；没有输出凭据。

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter web exec playwright test \
  --config=playwright.fullstack-smoke.config.ts \
  --project=seeded --project=seeded-github-import --project=board-unified-desktop \
  --no-deps --workers=1 \
  e2e/board-selection-layout.spec.ts e2e/board-thinking-input.spec.ts \
  e2e/chat-public-share.spec.ts e2e/board-connector-fast-snap.spec.ts \
  e2e/survey-complete-flow.spec.ts
```

退出0，28 PASS / 0 FAIL / 0 SKIP：7个恢复用例 + 12个connector场景 + 3个公开分享原有断言用例 + 6个survey用例。**这是补充验证，未包含待确认inbox，不能替代完整套件。**

运行来源：由正式fullstack配置构建并启动独立Web/API；隔离wrapper创建自有本地数据库/服务并清理。连接线用例检查实际运行chunk、源码标识、真实API/WS、服务端状态及peer；不是手填manifest。新私有测试库由wrapper seed，不改变任何既有数据库、账号或生产权限。

私有证据，不提交含会话数据的原始附件：

- `/private/tmp/board-restored-survey-3aae0186e.log`
- `/private/tmp/board-restored-survey-3aae0186e-receipt.json`：实际命令、退出码、SHA。
- `/private/tmp/board-remaining-3aae0186e-browser-artifacts.tar.gz`；SHA256 `f971956304561a142ff9f180aa4360a553318446e66564d522baaf4dc4edbdf6`。

## 失败历史与未执行边界

| 实际SHA / 范围 | 退出码 / 结果 | 首因与处理 |
| --- | --- | --- |
| f25481d64，18项定向 | 1：15通过、3失败 | 真实框选起点缺少安全边距，保留原断言修驱动 |
| 850c52162，完整20项补充入口 | 1：16通过、3失败、1跳过 | 缩小保留pan；3项框选准备失败，inbox跳过严格判未通过 |
| c276f9985，selection5项 | 1：4通过、1失败 | 三视口工具条右越界32px；已修真实resize和ref换绑 |
| c5c2222d3，正式完整209项，默认5 worker | 1：113通过、3失败、1跳过、92未执行 | 三个真实登录HTTP200但5秒内未完成导航；保留断言，降低并发 |
| c5c2222d3，相同209项，2 worker | 1：115通过、1失败、1跳过、92未执行 | 上述3项已通过；survey采到颜色过渡帧，已修精确等待 |
| 3aae0186e，最新28项定向 | 0：28通过、0失败、0跳过 | 上述修复受影响场景通过；不是完整209项通过 |

原始完整日志保留在 `/private/tmp/board-fullstack-c5c2222d3.log`、`/private/tmp/board-fullstack-c5c2222d3-workers2.log`；后者失败trace/error-context另存 `/private/tmp/board-fullstack-c5c2222d3-workers2-failures/`。首轮三个登录失败的原始trace已被后续Playwright运行清除，不能宣称仍留有trace；原始文本日志与已提取的HTTP200及导航首错仍有本次工具记录。

独立单测：connector 27/27；toolbar + connector 48/48（实际SHA c5c2222d3），日志 `/private/tmp/board-position-connector-c5c2222d3.log`。补充registry反证3/3。Web/API类型检查、定向lint及生产构建类型检查通过；这些不能单独证明产品验收。

## 继续前需要的唯一产品决定

[具体A/B提案](../../proposals/PROP-INBOX-SUBMIT-DESTINATION-5764.md)。已有confirmed UC-F1要求提交后留在“我提过的”，旧R4.1要求自动导航；不能代改人类签核。

- A（推荐）：仅新增管理员“新建反馈并分诊”入口导航；其他入口，包括管理员chat反馈，维持“我提过的”。原inbox断言从此明确分诊入口触发。
- B：所有管理员入口提交后导航，包括chat反馈；普通成员留在“我提过的”。需明确接受UC-F1的管理员例外。

两方案均不改变后端权限/API/数据库；同组织成员的既有inbox读取权限不收回，D3正文保护和管理员分诊权限保留。

确认后由开发子智能体实现，root验证真实单次201、服务端ID、drawer与刷新、默认入口反证和失败无重发；解除最后fixme。之后冻结源码，完整20项补充入口、209项fullstack、正式原生25项均需实际通过，再review/CI/合并。

正式原生当前源码 R01 8 / Connector 7 / Files 6 / Sync 4：全部 NOT_RUN；不挪用已合并PR #5691的旧SHA结果。本机已核对PostgreSQL16.15/vector0.8.6工具可用。五类身份、非owner app_rw/RLS等正式证明也须随最终原生producer重跑，不能用本轮owner/editor场景替代。硬件与暂缓人工视觉验收仍独立未完成。

未部署、未改变生产权限。开发worktree自建node_modules为释放磁盘已删除；独立验收worktree依赖完整，源码和证据保留。主工作区与其他会话worktree不变。
