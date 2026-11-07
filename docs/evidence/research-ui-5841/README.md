# 用户研究 UI 三轮优化（#5841）

基线：0acfa6628f9380c64ece5732c066e999d2e57651。分支 worker/coord-deep-research-5841-ui。
只修改研究域局部，无共享壳/token/API/权限变更。用户直接授权执行，角色认证仍缺凭据，不冒充租约持有。

## R1 视觉与层级
本轮发现：创建与已保存会话的助手入口位置/尺寸不一致；报告在窄屏先铺开完整目录挤后正文。
改动：研究域专用 ResearchFloatingAssistant 统一入口/面板尺寸与边距；创建页预留入口空间；报告目录小屏可展开，桌面常显，原链接不变。
验证：r1-red.txt 记录新增目录操作断言先失败；r1-green.txt 三文件27项通过，含现有布局与助手回归。该轮是组件验证，未冒充真实浏览器证据。
适用既有引导式研究UI签核下的一致性/响应式修复；不代签新增能力，新增业务能力不在范围。

## R2 交互与恢复
R1 SHA：f80cdc5d2。
本轮新增失败断言实测两项问题：助手无具名面板/关闭与Escape焦点返回；超长需求无错误关联且无效可选字段藏在折叠区。
修复：具名非模态研究助手、显式关闭、Escape关闭并返回入口、打开后焦点落关闭控件；可选字段错误自动展开，超长需求aria-invalid/aria-describedby关联，创建失败反馈改为标准字号。
r2-red.txt：2项失败、23项通过；修复后r2-green.txt：4文件51项通过，覆盖真实创建API客户端的受控失败/幂等重试/内容保留（组件环境，不是生产链路）。

## R3 真实浏览器检查与修正（已验证）
R2 SHA：44cca8288。
独占资源：本worktree Next dev 127.0.0.1:3284、.next-research-5841；Playwright单worker，无数据库/容器/模型调用。
本轮真实新建页桌面截图发现重复“研究助手”标题（screenshots/r3-before-assistant-1280.png，已用view_image检查）；新增断言r3-heading-red.txt显示2标题，r3-heading-green.txt修复后26项通过。独立review指出已保存会话相同问题，r3-live-heading-red.txt复现；以embedded模式去掉内部重复标题和二次卡片边框，保留独立会话组件默认标题。
实际助手内无Select/Combobox/Popover，未发现内层Escape消费冲突，不为假设添加控件或逻辑。已有Escape关闭/焦点返回仍验证。
环境问题：第一次webServer120秒启动超时；直接观察发现 /research/new 首编译99.1秒、/research首编译201.6秒。旧90秒导航测试受编译影响，不当作产品缺陷。浏览器选择器曾将Next路由播报器role=alert计入错误提示，修正为研究主区域内断言。

R3产品与测试SHA：2b00fd67879bfcaeb1939c802687832d1f044293。
最终复核：主会话对R1/R2及R3产品diff阶段验收通过；独立只读review复核embedded标题修复，无新增明确问题。

## 最终验证与边界
- `WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web exec vitest run tests/ui/research-ui-consistency.test.tsx tests/ui/research-production-routes.test.tsx tests/ui/guided-research-conversation-live.test.tsx tests/ui/guided-research-reference-layout.test.tsx tests/ui/guided-research-skill-assistant.test.tsx` → exit 0，5文件63项，unit-final.txt。
- `pnpm --filter web exec playwright test --config e2e/research-ui-consistency.config.ts --max-failures=1` → exit 0，7项，r3-browser-green.txt。实测时使用本会话手动启动、已核实归属的3284服务；配置默认禁止复用其他服务，显式RESEARCH_UI_5841_OWNED_SERVER=1仅供自己拥有的既有服务。
- `pnpm --filter web exec tsc --noEmit --project tests/research-ui-consistency.tsconfig.json` → exit 0。该配置覆盖全部7个产品文件、变更测试和依赖图，包含setup-dom matcher类型；typecheck-affected-green.txt记录工具观察到的退出码（TypeScript成功时无stdout）。初次漏setup-dom及测试误用exact参数的失败输出保留，随后已修复。
- 7个产品文件的 `next lint --file ...` → exit 0，lint-affected.txt；`pnpm --filter web lint:design` → exit 0，lint-design-final.txt。
- 全web `pnpm --filter web typecheck`曾运行后由本会话主动终止以限制本机并发资源，未声称通过；本轮以可复现的受影响类型检查收口，随后pre-push完整Web检查已通过（见下方增量）。
- 浏览器覆盖1280/768/375、空输入/长内容、格式错误后修正、未登录创建失败后的内容保留、助手开关/Escape/焦点返回、目录开关/无横向溢出。所有截图为真实本地Chromium；报告为既有固定fixture，未运行研究引擎、模型或数据库。
- fixture导航中的资料页与报告页同属第三步骤，激活步骤不推进引擎；最终测试验证输入→主题→计划编辑保存→资料页，再单独读取固定报告样本。不得称为真实报告生成/持久化验收。
- 既有恢复会话状态卡的完整重设计不在本次实现；本次实际范围收敛为助手、表单反馈、报告目录三处一致性修复，保留原API/业务权限/状态。无新增feature passing、无人类签核代签。

## 截图绝对路径
前缀：`/Users/shenyangjun/.codex/worktrees/8ebc/workspacex/docs/evidence/research-ui-5841/screenshots/`。
每档1280/768/375均有 `empty-entry-N.png`、`assistant-N.png`、`input-error-N.png`、`create-recovery-N.png`、`report-N.png`；另有fixture-navigation.png和修复前r3-before-assistant-1280.png。
已视觉检查桌面助手、375助手、375空输入/创建失败、桌面/375报告；其余同档交互由浏览器断言覆盖。

## 资源与交接
本会话的3284 Next服务已停止；未创建数据库或Docker栈；只移除自己启动的Next所加tsconfig include hunk，apps/web/tsconfig.json无diff。专属worktree依人类长期会话指令保留。
PR已创建：https://github.com/boardx/workspacex/pull/5845（Closes #5841）。下一步负责CI至绿，不自行合并。认证/租约仍因缺合法协调凭据而未知；这不被报告为认证成功。

## 完整 base..HEAD 文件清单（包含本报告与证据）
```text
.agents/skills/mod-user-research/SKILL.md
apps/web/components/research-studio/guided-research-conversation.tsx
apps/web/components/research-studio/guided-research-live.tsx
apps/web/components/research-studio/guided-research-report-workspace.tsx
apps/web/components/research-studio/guided-research-six-step-shell.tsx
apps/web/components/research-studio/guided-research-step-layout.tsx
apps/web/components/research-studio/research-floating-assistant.tsx
apps/web/components/research-studio/research-intake.tsx
apps/web/e2e/research-ui-consistency.config.ts
apps/web/e2e/research-ui-consistency.spec.ts
apps/web/playwright.prototype-audit.config.ts
apps/web/tests/research-ui-consistency.tsconfig.json
apps/web/tests/ui/guided-research-conversation-live.test.tsx
apps/web/tests/ui/research-production-routes.test.tsx
apps/web/tests/ui/research-ui-consistency.test.tsx
docs/evidence/research-ui-5841/README.md
docs/evidence/research-ui-5841/ci-control-plane-failure.txt
docs/evidence/research-ui-5841/ci-prototype-test-list.txt
docs/evidence/research-ui-5841/ci-spec-coverage-green.txt
docs/evidence/research-ui-5841/init-final.txt
docs/evidence/research-ui-5841/lint-affected.txt
docs/evidence/research-ui-5841/lint-design-final.txt
docs/evidence/research-ui-5841/lint-design.txt
docs/evidence/research-ui-5841/pre-push-full-web.txt
docs/evidence/research-ui-5841/progress.md
docs/evidence/research-ui-5841/r1-green.txt
docs/evidence/research-ui-5841/r1-red.txt
docs/evidence/research-ui-5841/r2-green.txt
docs/evidence/research-ui-5841/r2-red.txt
docs/evidence/research-ui-5841/r3-browser-final.txt
docs/evidence/research-ui-5841/r3-browser-first.txt
docs/evidence/research-ui-5841/r3-browser-green.txt
docs/evidence/research-ui-5841/r3-browser-retry.txt
docs/evidence/research-ui-5841/r3-heading-green.txt
docs/evidence/research-ui-5841/r3-heading-red.txt
docs/evidence/research-ui-5841/r3-live-heading-green.txt
docs/evidence/research-ui-5841/r3-live-heading-red.txt
docs/evidence/research-ui-5841/r3-navigation-retry.txt
docs/evidence/research-ui-5841/r3-navigation.txt
docs/evidence/research-ui-5841/results.json
docs/evidence/research-ui-5841/screenshots/assistant-1280.png
docs/evidence/research-ui-5841/screenshots/assistant-375.png
docs/evidence/research-ui-5841/screenshots/assistant-768.png
docs/evidence/research-ui-5841/screenshots/create-recovery-1280.png
docs/evidence/research-ui-5841/screenshots/create-recovery-375.png
docs/evidence/research-ui-5841/screenshots/create-recovery-768.png
docs/evidence/research-ui-5841/screenshots/empty-entry-1280.png
docs/evidence/research-ui-5841/screenshots/empty-entry-375.png
docs/evidence/research-ui-5841/screenshots/empty-entry-768.png
docs/evidence/research-ui-5841/screenshots/fixture-navigation.png
docs/evidence/research-ui-5841/screenshots/input-error-1280.png
docs/evidence/research-ui-5841/screenshots/input-error-375.png
docs/evidence/research-ui-5841/screenshots/input-error-768.png
docs/evidence/research-ui-5841/screenshots/r3-before-assistant-1280.png
docs/evidence/research-ui-5841/screenshots/report-1280.png
docs/evidence/research-ui-5841/screenshots/report-375.png
docs/evidence/research-ui-5841/screenshots/report-768.png
docs/evidence/research-ui-5841/session-handoff.md
docs/evidence/research-ui-5841/typecheck-affected-final.txt
docs/evidence/research-ui-5841/typecheck-affected-green.txt
docs/evidence/research-ui-5841/typecheck-affected.txt
docs/evidence/research-ui-5841/typecheck.txt
docs/evidence/research-ui-5841/unit-final.txt
```

## 推送门禁增量
0333a9562推送时，仓库pre-push完整Web `typecheck` 与完整 `lint` 全部exit0（4/4 Turbo任务成功，1m34.832s），见pre-push-full-web.txt。此前本地主动中止的记录只是历史，不再是最终验证缺口。当前产品差异仍为已审查的2b00fd678；后续只更新证据。

## CI覆盖修复（无产品源码新增）
PR #5845 在 head 5c1006481 的 verify-control-plane（run39374284856/job118469131649）明确将新增研究spec判为unrun。修复仅在 apps/web/playwright.prototype-audit.config.ts 的testMatch中加入research-ui-consistency，接入已有无DB单worker CI车道，不添加豁免。
本地 `node .harness/scripts/lint-spec-gate-coverage.mjs` 显示该spec covered并通过；现有CI配置 `playwright test --config playwright.prototype-audit.config.ts --list` 收集36项/3文件，含本模块7项（ci-spec-coverage-green.txt、ci-prototype-test-list.txt）。独立只读复核配置修复未发现明显问题。随后等待CI实际跑绿。
