# 会话交接 — Sprint 01/19

## 当前已验证
- F966：`passing`。2 条 verification 全绿（`typecheck` + `project-results-live.test.tsx`）
  + `verify:quick`（standard 档）已跑绿。evidence 见 `evidence/F966.verify.log`。

## 本轮改动
- `apps/web/next.config.mjs`：补 `GET /provenance` 的 Next.js rewrite 规则（真 bug 修复）。
- `apps/web/e2e/project-results-shots.spec.ts`：真栈截图取证 spec（新增）。
- `apps/web/playwright.fullstack-smoke.config.ts`：新增具名 project `project-results-shots`。
- `package.json`：新增 `shots:project-results[:raw]`。
- `.gitignore`：`.project-results-shots/`。
- 设计签核：`design-signoff.md` 追加 F966（零新增设计面）。

## UIUX 保真度：8/10
真栈截图（`pnpm run shots:project-results`）验证：成果去向/审计与反馈两节端到端真实
链路已跑通（真实 fetch → 真实空态/真实 403），404 路由缺口已修复。未到 9-10 分的
两个缺口是证据缺口（fixture 未种数据、只拍 default 一态），不是代码缺陷。

## 仍损坏或未验证
- **已做过一次工作量探测（本会话内），结论：换账号这条捷径走不通，必须真种子**。
  新增 `project-results-shots.spec.ts` 的 probe 用例（真跑、真通过，非臆测）：
  用 `FULLSTACK_E2E.leadEmail` 登录后，「审计与反馈」从 403 变成真实空态
  （证明其它 seeded spec 写的 provenance 事件不 target 这个具体 projectId，
  换账号拿不到「免费」数据），而「成果去向」反而从空态劣化成
  `NO_PROJECT_ROLE`（org lead 与 project 角色是种子里两件独立的事，
  `leadEmail` 只被加成 org lead，从未加进这个项目的 project_memberships）。
  要拍到「有数据」的成功态，需要：① 给 fixture 补至少一条 backflow 绑定
  （理解 artifact_versions/binding schema）+ 一条 provenance 事件；② 让登录账号
  同时具备 org 审计读权限与 project 读权限（两个账号分开种再合成，或同一账号
  两边都种）。工作量比预期（只加 1-2 行）更大，如实停在 8/10，留给下一轮。
- 项目结论/假设状态/发布结论/候选决策四块的真实领域模型仍未建（F965 范围内的已知
  缺口，契约未建模，需要新的契约设计与人类签核）。

## 下一步最佳动作
- 人工审核并合并本 PR。
- 若要继续冲 UIUX 分数，先做种子数据补齐（见上）。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/19`
- 截图:`pnpm run shots:project-results`
