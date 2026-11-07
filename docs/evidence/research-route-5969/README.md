# #5969 用户研究 route 连续性

基线：`4b59fe4a171620ccaae894c22eea05ee05b08a7d`（origin/develop）。任务分支：`codex/research-route-continuity`。

## 变更

- GuidedResearchLive 从已有研究快照同步初始化；切换步骤时保留数据，后台只读 revalidate。冷加载仍读完整 runtime。
- 捕获每次请求的 baseline 并使用现有 newestSnapshot/epoch 控制，迟到读取不能覆盖新命令或流状态；普通后台刷新和后续轮询均保护未提交草稿。
- 同一研究各步骤的草稿仅保存在页面内存；用户明确选择放弃时移除该步草稿，完整页面刷新以服务端已保存状态为准。
- 研究数据、名称和并发 GET 按 bearer + 当前组织 + 研究隔离；同基线并发读去重，已完成响应不充当长期缓存。metadata mutation 与读取使用同一 scope。
- 明确 401/403/404 清理缓存并关闭内容，普通连接失败保留可读内容。名称缓存即时显示并向后端校验。
- 不改产品鉴权、服务端状态机、模型生成或质量门；既有新建确认后的 prepare_plan 引导行为保留。

## 验证

- `continuity-red.log`：新增热缓存即时显示、route切换保留草稿断言在原实现上 2 failed / 3 passed。
- `access-red.log`：明确访问拒绝清缓存断言在修复前 3 failed / 8 passed。
- `ui-tests.log`：34 个研究相关测试文件、370 项测试通过。覆盖冷加载、热缓存、后端变化、草稿、运行中切换、旧响应、权限拒绝、研究/凭据/组织隔离及 StrictMode 去重。
- `browser.log`：真实 Chromium + Next 页面 /research/:id/import → plan → report → import，1 项通过。HTTP为受控响应：延迟 progress GET 时计划仍显示；后台 report patch 更新正文；取消离开保留草稿；该路径 POST=0。
- `browser-results/`：实际计划校验延迟期间、返回编辑后的截图，已目视检查。
- 类型检查、完整 Web lint 与 init 日志在对应文件留存，以各日志退出结果为准。

复现命令：

```bash
cd apps/web
pnpm exec vitest run tests/ui/guided-research-*.test.tsx tests/ui/guided-research-memory.test.ts tests/ui/research-production-routes.test.tsx
pnpm exec playwright test --config e2e/research-route-continuity.config.ts
cd ../..
pnpm --filter web run typecheck
pnpm --filter web run lint
./init.sh
```

Next 启动会自动向 tsconfig.json 添加本测试 distDir types；测试后仅撤回该自动产生的 include，不提交生成物。Playwright退出后自动停止其专用 Web 服务；未启动 Docker。

## 验收与限制

这是前端修复及受控 HTTP 浏览器证据，不声称真实数据库、模型供应商或生产部署通过。首次进入某个研究或完整页面刷新仍需读取服务端；页面缓存限3个研究，页面刷新不保留未提交编辑。

人类明确授权仅本 chat / #5969 跳过协调租约认领前置，实际租约未取得。例外存本地 ignored 记录并已写 issue 评论；未扩展到其他任务、未改全局校验。

交付方式：先将最终 commit SHA 和本材料交父 chat 验收；明确通过后才创建 develop PR（Closes #5969），不自动合并。当前不宣称已发布或 feature passing。

本轮上述类型检查、完整 Web lint（包含 gen-light-scope 与 lint-design）、快速 init 均退出0。独立 reviewer 两轮复核访问撤销/轮询草稿修正及组织隔离后，无重要未解决发现；其独立定向43测试通过。

```mermaid
flowchart LR
 A[同步与根因分析] --> B[实现与反证] --> C[370测试及浏览器验证] --> D[父chat按SHA验收] --> E[develop PR与CI]
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
 classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
 classDef doing fill:#fde68a,stroke:#d97706,color:#111827
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
 class A done
 class B tested
 class C tested
 class D doing
 class E todo
```

## 父 chat 复审修正（2026-10-28）

父 chat 在 a99a64a0 发现两项 P2，当前补充：

- 热缓存 version0 不再直接触发 prepare_plan；当前 route 后端校验成功后才允许既有新建确认引导。延迟 GET 期间零执行、后端版本已推进、403 拒绝访问均不启动；后端确认仍为新建状态时保持一次正常启动。
- 名称读写共用 memory nameRevision；成功改名推进代际，较早 metadata GET 只能保留已保存的新名称。测试实际调用 updateGuidedResearchMetadata 成功写入 B 后，才释放返回 A 的旧 GET。
- review-red.log：两条新增路径在修复前复现，3 failed / 39 passed。review-tests.log：5 个定向文件、76 项通过（包含新建正例、真实 metadata mutation、既有三步流程与步骤切换）。独立 reviewer 另跑3个文件48项通过，无新的重要发现。
- Web 类型检查与本次3个业务文件的定向 Next lint 通过，日志 review-typecheck.log、review-lint.log；完整 baseline..HEAD 的 diff --check 也通过。
- 本次不重复已绿的完整研究测试、浏览器与 init；既有370项和受控 Chromium证据属于前次实现验证。本次只报告新增修复的定向结果，不扩大为真实服务端或线上验收。

仍需父 chat 对本次最终 SHA 明确验收，之后才可创建 base=develop、Closes #5969 的 PR。

## PR #5971 CI 接线修正

父 chat 已验收 f9387eabf，创建 base=develop 的 PR #5971。首轮 verify-control-plane 的 spec ↔ 门控可达性失败：新 research-route-continuity.spec.ts 仅由本地命令调用，未注册到 CI。本地门控复现 unrun（ci-spec-gate-red.log）。

在现有 organization-create 浏览器 job 复用 pnpm / Chromium 安装，增加受控 HTTP 研究 route spec 和截图/trace上传；不增加 runner、不改门控脚本或豁免，不改产品代码。完整可达性门控转绿，静态发现链路为 harness-verify.yml#organization-create 无条件调用该 config；对应门控24项测试通过，日志 ci-spec-gate-green.log / ci-spec-gate-tests.log。静态注册通过不代表本次 CI 浏览器执行已经通过，需继续检查更新后的 CI。
