# 问卷 UI 三轮优化验收报告 — #5840

## 结论与边界

三轮实现已完成，相关35条组件测试、真实浏览器全流程、typecheck、设计lint、受影响ESLint及初始化快速健康检查均退出0。最终9张截图已逐张查看。生产全量Web构建车道曾在600s启动超时，保留失败；最终浏览器证据来自真实隔离API/数据库/鉴权 + Next dev，不能据此声称生产构建已通过。最终CI及PR状态以GitHub实时检查为准。

唯一页面改动为 `/studio/survey` 列表。保留现有ResourceCard、TagFilterBar、Button、Input与业务API，不改共享壳、全局token、API/DB契约或其他模块。不修改feature passing与签核状态。答卷页仅验证从列表可达和真实空答卷，不声称整个问卷模块所有页面均完成视觉重构。

## 基线、身份与审查

- worktree：`/Users/shenyangjun/.codex/worktrees/e7f9/workspacex`，全程复用，没有创建第二个。
- base：`0acfa6628f9380c64ece5732c066e999d2e57651`，开工fetch时与origin/main一致。
- 分支：`worker/coord-survey-5840-library-ui`；issue：<https://github.com/boardx/workspacex/issues/5840>。
- R3源代码SHA：`1626f24ed02cb3c658a8bd3c7ee65f755148ed9d`。后续报告提交不改变被测产品代码。
- registry中的coord-survey已启用，areas为survey/questionnaire。仍无合法协调凭据，未完成真实角色认证，租约未知；未认领或抢占。开发按人类直接授权推进，不冒充协调认证成功。
- 已读取survey束既有签核与UI范围；本次修复列表层级、已有状态及恢复，不新增业务能力或代签。主会话已阶段审查R1/R2/R3产品diff无阻断项，并授权最终浏览器/静态验证及稳定截图通过后自动建PR。
- 去重已核对#4551、#4915、已关闭#4609/#4800。项目上下文导航及设计器更多操作风险未混入本issue。

## 三轮独立记录

| 轮次 | 实际发现与修改 | 源代码SHA | 实际验证 |
|---|---|---|---|
| R1 视觉与层级 | 筛选时展示匹配N/共M；加载期间不提前报共0；报告模板推广卡仅在无筛选列表保留，避免与零命中提示混杂 | `5b50a9db7f0ffc4a0ba6bf7a116c76c25d504e48` | 新增2条先RED（18通过），修复后相关3文件32条通过 |
| R2 交互恢复 | 错误区原地重新加载，忙时禁用并用ref阻止并发；保留筛选；恢复与清除筛选后回搜索焦点；aria-busy | `2c8074641613e10e2adea8ec356bb07cff63a73f` | 新增2条先RED（20通过），修复后3文件34条通过 |
| R3 实测修正 | 卡片标题用现有headingLevel=2修复h1→h3跳级；真实浏览器覆盖核心路径与三档布局；修正验收路由冷编译、登录导航同步、alert选择器及主题中间帧取证 | `1626f24ed02cb3c658a8bd3c7ee65f755148ed9d` | 标题回归先RED（22通过），修复后35条通过；完整浏览器20.4s，1 passed，外壳退出0 |

RED/GREEN原始输出在 `evidence/r1-red.txt`、`r1-green.txt`、`r2-red.txt`、`r2-green.txt`、`r3-red.txt`、`r3-green.txt`。每轮进展与诊断已同步issue评论。

## 可复现验证

以下均已真实执行并退出0：

```sh
WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web exec vitest run tests/ui/survey-live-library.test.tsx tests/ui/survey-create-dialog.test.tsx tests/ui/survey-route-layout.test.tsx
pnpm --filter web typecheck
pnpm --filter web lint:design
pnpm --filter web exec next lint --file components/survey/live/survey-library.tsx --file tests/ui/survey-live-library.test.tsx --file e2e/survey-complete-flow.spec.ts --file e2e/survey-ui-warmup.ts --file playwright.survey-ui.config.ts
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.survey-ui.config.ts --project=seeded e2e/survey-complete-flow.spec.ts --grep 5840 --workers=1
./init.sh
```

`init.sh`仅默认快速健康检查，不是全仓验证。静态输出见 `evidence/typecheck-final.txt`、`design-final.txt`、`eslint.txt`、`init-final.txt`；浏览器完整输出见 `evidence/browser-acceptance.txt`。`git diff --check`通过。

## 真实浏览器覆盖及证据判定

- Chromium，单worker，既有with-test-isolation + 全栈配置中的真实seed/auth/API/数据库；Web使用模块专属Next dev，仅编译访问页面。
- 真实UI登录且断言auth/login响应成功；空库→命名/打标签→POST创建→设计路由→回列表→刷新恢复同一ID与长标题→搜索/标签组合→匹配计数→明暗主题→1280/768/375无body横向溢出→零结果键盘清除与焦点恢复→请求失败及再次失败→加载反馈及禁用→真实GET恢复、搜索保留和焦点→查看真实空答卷。
- 仅列表503和延迟由浏览器定点注入，以验证UI错误恢复；登录、创建、刷新、恢复GET和答卷导航均走真实API。没有用mock页面或组件测试替代浏览器。
- 最终运行：`run-mvg8nji9-fe280f4d-bf59740747a0`；DB `wsx_bf59740747a0aab166b4`；compose `wsx-bf59740747a0aab166b4`；API24663/Web25663。锁等待20s、命令1m21s、清理1s，总计1m42s，退出0。
- 截图前保留实际颜色同步断言，排除主题切换中间帧；有限动画在截图时完成。没有改断言超时或用固定sleep掩盖错误。

### 最终截图（绝对路径，全部已查看）

- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-empty.png`
- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-error-375.png`
- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-loading-375.png`
- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-no-results-375.png`
- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-response-empty-375.png`
- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-results-1280.png`
- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-results-375.png`
- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-results-768.png`
- `/Users/shenyangjun/.codex/worktrees/e7f9/workspacex/docs/proposals/survey-ui-5840/screenshots/5840-results-dark.png`

## 第三轮失败、诊断与修正历史

| 运行 | 真实结果 | 处理与证据 |
|---|---|---|
| 生产全栈启动 | 600000ms webServer超时，零测试执行；期间本轮Postgres服务重初始化并恢复 | 保留 `evidence/r3-production-startup.txt`；未延长超时，清理原栈并释放锁，再使用模块dev入口 |
| dev冷路由 | 登录后home冷编译未完成，原5000ms URL断言失败 | `r3-dev-cold-route.txt`；模块globalSetup仅经HTTP预热实际路由，不绕过真实登录 |
| dev选择器 | 已完成真实创建/筛选/三档/零结果，错误区alert与Next route announcer重复 | `r3-dev-selector.txt`；收窄到已有err-survey-library testid，保持错误断言 |
| dev登录同步 | trace中auth/login 200耗时4444.879ms，home 200耗时1094.013ms | `r3-dev-login-timing.txt`；本条用例显式等待真实登录响应及导航，再执行原URL断言，总超时120000ms不变 |
| 首次流程通过 | 全断言通过，但浅色桌面标题仍处主题切换过渡色 | `browser-first-pass.txt`；拒收该桌面图，追加实际颜色一致断言再截图 |
| 最终稳定回归 | 1 passed、20.4s，9张最终截图稳定 | `browser-acceptance.txt`；独立逐张查看，未发现列表范围内阻断项 |

## 文件清单、资源与交接

完整base..交付文件清单见 [file-manifest.txt](file-manifest.txt)，仅5个问卷源代码/测试配置文件及本报告目录。未修改共享壳、全局token、其他模块或tsconfig。Next自动新增的 `.next-survey-ui-e2e/types/**/*.ts` 已逐次仅移除本轮hunk，未覆盖其他配置。

本session创建的compose `wsx-015f1247d4c292241ec0`、`wsx-2ca5ec6b9ebd918ed4cb`、`wsx-0d312b07fbc8c31f2d40`、`wsx-6a89df5e04a37b71c5f7`、`wsx-51b48dba3a9fa6fe7e38`、`wsx-bf59740747a0aab166b4` 均由各次隔离外壳清理；最终逐一查询无残留容器。没有停止其他session的资源。专属worktree按人类长期会话要求保留。

独立代码审查结果与PR/CI状态会在issue/PR更新。不自行合并。协调身份认证仍需合法凭据文件路径，15分钟待命巡检继续保留，未声称续租成功。
