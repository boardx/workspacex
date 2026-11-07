# 用户访谈 #5843 三轮浏览器记录

本次新执行；所有截图为当前专属 worktree 启动的 Next 实际页面和 Chromium 渲染，不是生产截图或登录页。产品最终基线 `b7b0e6e87ec66423e3d2e8521f2b5b8a4b0b84ce`。浏览器 HTTP/session fixture 沿用仓库已有 `digital-interview-research-quality.spec.ts` 方案；它不验证真实登录、API持久化、数据库或模型输出，全部写入被本地 route 拦截。

## R1：统一视觉和信息层级

在 R2 已提交基线 `304d22a23` 检查本轮 R1 产物（并非把此时浏览器结果冒充纯 R1 SHA）：1280/375完成卡显示查看报告、完成计数，隐藏重复进度条；实际路径来源阶段为 report。截图 `r1-list-1280.png`、`r1-list-375.png`。初始 fixture 将 completed 与 sourceStep=intake 混搭，产品正确恢复 intake；修正夹具后通过，未改产品迎合夹具。

## R2：交互友好

1280/375 创建弹窗初始聚焦名称；空白名称有可见说明且禁止提交。受控503创建失败保留名称并聚焦 alert；再次提交仍失败后继续保留输入（此项不宣称成功创建）。Escape关闭。截图 `r2-create-failure-1280.png`、`r2-create-failure-375.png`。

## R3：真实验收与修正

发现真实缺陷：375×667、10个长标签+503时弹窗 top=-36.75、bottom=703.75，越过上下边界。before见 `r3-before-long-tags-375x667.png` 和 `browser-before-results.json`（304d22a23）。实现者据此增加本模块 Dialog 最大高度与纵向滚动。

在最终基线 b7b0e6e87 回归同场景：top=16、bottom=651，scrollHeight739/clientHeight633；alert聚焦，滚动至CTA后可见且能再次点击失败重试。after见 `r3-long-tags-375x667.png`、`r3-after-long-tags-cta-375x667.png`。

其他显式通过项：受控 pending HTTP 时加载DOM可见，解除后显示列表；空态说明可见且可打开创建；失败态说明可见且点击重新加载恢复；上述窄屏无document横溢。100字无空格工作台标题+658字符需求在1280/375均无横溢（scrollWidth=clientWidth），研究需求 Markdown 标签可见。成功创建→intake→确认→analysis链路已真实操作（API返回夹具），见 `r3-created-analysis-375.png`。见 `browser-check-results.json`、`browser-long-header-results.json`。

既有真实浏览器专项重新运行：new setup 响应式及六阶段桌面/768/390完整工作台检查，共2项通过（5.1分钟）；含返回列表、专家弹窗、长报告与各阶段导航。记录 `browser-existing-spec-retry.txt`。初次冷编译耗时281秒导致导航预算超时，暂停旧批次降负载后重试成功；保留 `browser-existing-spec-initial.txt`，未将冷编译超时当产品失败。

## 复现

启动（独立端口与dist目录）：

```sh
NEXT_DIST_DIR=.next-interview-ui-5843 NEXT_PUBLIC_API_URL=http://localhost:35843 NEXT_PUBLIC_API_PATH_PREFIX='' pnpm --filter web exec next dev -p 35843
node docs/evidence/interview-ui-5843/browser-check.cjs
node docs/evidence/interview-ui-5843/browser-long-header.cjs
INTERVIEW_REVIEW_EVIDENCE_DIR=$PWD/docs/evidence/interview-ui-5843 pnpm --filter web exec playwright test --config ../../docs/evidence/interview-ui-5843/browser-playwright.config.cjs --grep 'new setup opens|prototype journey|a failed report keeps'
```

首次编译应先等待服务实际返回200再运行测试。Next自动加入tsconfig的本次dist include已精确撤销，未改共用配置。浏览器截图绝对目录：`/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/`。

报告失败恢复专项另跑：1项通过（20秒），断言失败后保留部分正文并暴露重试；见 `browser-report-failure.txt`。已目视检查R3 before/after及长标题截图，after可滚动操作、标题正文无横溢。未操作真实录音、模型或生产数据。

资源清理：本agent独立Next服务35843已SIGINT退出；lsof核验无35843监听，已结束的专属测试worker/browser进程不存在。无Docker栈。仅浏览器证据文件待实现者统一提交。
