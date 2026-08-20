/**
 * F965 —— 抓「成果沉淀」tab 的**真栈产品侧截图**，与已签核的
 * `phases/phase-01-run-a-project/ui-preview/project-v2/uc-00-3-results-*.png`
 * 十张基准图逐张比对，供 rev-uiux 保真度评分使用。
 *
 * ## 为什么必须跑真栈而不是 mock 预览路由
 * `/projects/[projectId]` 自 issue #1316（安全修复）起不再向 `ProjectWorkbench` 传
 * mock `identity`——`AppShell` 因此总落到 `SessionAppShell`，未登录直接
 * `router.replace("/login")`。用 `?state=`/`?as=` 之类的 mock 预览参数根本走不到这个
 * 页面（不只是「成果沉淀」tab 的问题——`overview`/`prep`/`live` 等所有 tab 今天都
 * 同样被这条安全修复挡住，实测确认见 issue #1627 的评论）。`shot-project-v2.mjs`
 * 当年（2026-07-30）能拍出这批基准图，是因为那时候页面还在 mock 身份；#1316（
 * 2026-08-16）之后它对这条路由整体失效，与 F965 无关。要证明真实渲染，只能走
 * 真登录，所以复用 `playwright.fullstack-smoke.config.ts` 的整栈（同
 * `agenda-segment-create-smoke.spec.ts`），不是新造一套。
 *
 * ## 这不是门控
 * 没有断言产品「保真度像不像」——那是人 + rev-uiux 的事。本文件只负责把「屏在真栈上
 * 真实渲染成什么样」如实抓下来，由 `pnpm run shots:project-results` 显式调用。
 * ⚠ 与 chat-main-shots.spec.ts 不同，本文件**不需要**登记进
 * `lint-spec-gate-coverage.mjs` 的 EXEMPTIONS——它独立成
 * `playwright.fullstack-smoke.config.ts` 里一个具名 project
 * （`project-results-shots`），该门控按「这个 config 文件整体 `--list` 能不能列出它」
 * 判定覆盖（门控自己文件头写明的判定粒度是「配置文件」而非「project」），所以判它
 * `covered`——不代表 CI 会真的跑它：`verify:fullstack-smoke` 只显式点
 * `--project=seeded-github-import`，沿 `dependencies` 反解只会拉起 `seeded` 与
 * `seeded-github-import` 两个 project，不会拉起这个新增的 `project-results-shots`
 * project（没有任何 project 把它列进 `dependencies`，也没有任何 CI 脚本显式
 * `--project=project-results-shots`）。
 *
 * ## 已知局限（如实标注，不是缺陷；已做过一次工作量探测，见下面第二个 test）
 * `fullstack-smoke-fixture.ts` 没有为这个项目种任何 `backflow`/`provenance` 数据
 * （种子清单里没有这两类），所以「成果去向」「审计与反馈」两节这里拍到的是**真实的
 * 空态**（`project-results-destinations-empty`/`project-results-audit-empty`），
 * 不是基线图里 populated 的示例内容——空态本身也是需要验证的真实路径之一
 * （七态之一）。**实测过「换账号能不能白拿数据」这条捷径，结论是不能**（见下面
 * `probe` 用例头注）：org lead 与 project 角色是分开种的两件事，且没有任何现有
 * spec 往这个具体 projectId 写 provenance 事件——要拍到"有数据"的成功态，必须
 * 真的给 fixture 补种子（至少一条 backflow 绑定 + 一条 provenance 事件，且登录
 * 账号要同时具备 org 审计读权限与 project 读权限），工作量比预期大，不在本次范围内。
 */
/**
 * ⚠ **实测发现（2026-08-20，见 issue #1627 评论）**：下面按 `?as=groupLead/member/
 * observer` 拍的三张图与 default 一张**像素级相同**——不是取证脚本的 bug。
 * `resolvePreviewRole()`（`lib/identity.ts`）逐字写着 `NODE_ENV === "production"` 时
 * **恒返回 `"facilitator"`**（R12 V8：预览视角切换器生产不可达），而本 spec 复用的
 * `playwright.fullstack-smoke.config.ts` webServer 跑的是 `next build && next start`
 * ——一次真正的生产构建。这是**故意的安全边界**（同一份注释：「预览开关不可达」），
 * 不是本 feature 该修的缺陷：用生产构建证明「URL 能伪造视角」反而是反着来的。
 * 四视角的真实差异（`canWrite`/`canPublish` 门控、`发布结论`/`候选决策` 两块的
 * 出现/消失）已经由 `apps/web/tests/ui/project-results-live.test.tsx` 的组件测试
 * 覆盖（真实 props 驱动，不依赖生产环境的 URL 开关），那才是验证角色投影的正确层。
 * 这里仍然拍这三张，是为了**如实留证**这个边界在真栈上确实生效（没有意外泄漏）。
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

test.setTimeout(300_000);

const OUT = resolve(process.env.PROJECT_RESULTS_SHOTS_OUT ?? ".project-results-shots");
const DESKTOP = { width: 1360, height: 1000 };

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("capture the results tab against the real stack (facilitator + three other views)", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize(DESKTOP);

  const shoot = async (file: string) => {
    await page.getByTestId("project-results").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  };

  await loginAs(page, FULLSTACK_E2E.email, FULLSTACK_E2E.password);

  // facilitator（fixture 默认账号的项目角色，见 fullstack-smoke-fixture.ts 头注）
  await page.goto(`/projects/${FULLSTACK_E2E.projectId}?org=${FULLSTACK_E2E.orgId}&tab=results`);
  await shoot("uc-00-3-results-default.png");

  // 三个非 facilitator 视角（`as=` 是本仓预览手段，参见 project-workbench.tsx；
  // 角色投影裁剪在服务端 RLS 强制，前端只是不下发操作按钮，这里拍的是真实渲染，
  // 不是伪造数据——liveOverview/liveAudit 仍来自这一次真实登录会话的真实 fetch）。
  for (const view of ["groupLead", "member", "observer"] as const) {
    await page.goto(`/projects/${FULLSTACK_E2E.projectId}?org=${FULLSTACK_E2E.orgId}&tab=results&as=${view}`);
    await shoot(`uc-00-3-results-${view}.png`);
  }
});

/**
 * 「有数据」成功态探测——**实测结论（2026-08-20）：换账号这条路走不通，需要真种子**。
 *
 * 假设：这个 project 的「seeded」project 依赖链里，其它 spec
 * （`agenda-segment-create-smoke.spec.ts`/`capability-mutate-smoke.spec.ts` 等）
 * 已经对同一个 org/project 做过真实的写操作，理论上会在 `provenance_events` 里
 * 留下真实事件；本用例只换一个持 org `lead` 的账号登录（审计检索按
 * `query-provenance.ts` 只对 org 级 lead/admin/compliance 开放），看看不新增任何
 * 种子代码、只换账号能不能拍到「审计与反馈有数据」的成功态。
 *
 * 实测（`uc-00-3-results-lead-probe.png`）：假设不成立，且换账号反而**新引入一个
 * 回归**——
 *   · 「审计与反馈」：403 变成了真实空态「本项目还没有审计事件，不生成示例条目」
 *     ——其它 spec 写的 provenance 事件不 target 这个具体 `projectId`（它们各自
 *     target 别的实体：capability/skill/membership 等），证明「换账号白拿数据」
 *     这条路径不存在，必须真种子。
 *   · 「成果去向」：从「暂无已回流的产出」（真实空态）变成
 *     「回流列表读取失败：NO_PROJECT_ROLE」——`fullstack-smoke-fixture.ts` 只把
 *     `leadEmail` 加成 org 级 `lead`（`addOrgMember`），从未把它加进这个项目的
 *     `project_memberships`，所以它对这个项目本身没有项目角色，`getProjectOverview`
 *     直接拒绝。换句话说：**org lead 与 project 角色是两件独立的事**，要同时拿到
 *     「审计读权限」与「项目读权限」，种子需要同一个账号两边都种，或者两个账号
 *     分别种数据后合成两张图——工作量比最初预期（只加 1-2 行 backflow/provenance）
 *     更大，已如实记录在 issue/PR，留给下一轮。
 */
test("probe: does logging in as the org lead surface any real audit data without new seed code", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize(DESKTOP);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);

  await page.goto(`/projects/${FULLSTACK_E2E.projectId}?org=${FULLSTACK_E2E.orgId}&tab=results`);
  await page.getByTestId("project-results").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/uc-00-3-results-lead-probe.png`, fullPage: true });
});
