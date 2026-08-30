/**
 * 核心旅程 ④：画布模板新建 → 编辑（测试）→ 发布 → 在项目里真正使用 → 该项目的 chat 可达。
 *
 * ## 「在 chat 使用」的诚实边界
 *
 * 全仓目前**没有**任何产品路径能把一个 canvas 模板直接插进一条 chat 消息里
 * （`grep -rn "canvasTemplate\|templateKey" apps/web/components/chat` 零命中）——
 * "使用"一个已发布模板，唯一真实存在的路径是 `bindTemplateToSegment`
 * （`POST /canvas/agenda-segments/:id/template-bindings`），把它绑定到工作坊的一个
 * 议程环节上，同 `core-loop.spec.ts` 步骤 8c。本旅程如实走这条真实路径，
 * 并把"使用"接到它唯一真实相邻的东西——**同一个项目的 chat 工作区**（模板绑定
 * 的议程环节与该项目的 chat 线程同属一个项目，是同一个工作流程的两个视野）——而不是
 * 编造一个不存在的"chat 里插模板"能力。
 *
 * ## 为什么复用种子里的议程环节，不新建一个
 *
 * `agenda-segment-create-smoke.spec.ts` 已经证明能新建议程环节，但新建出来的默认是
 * `待开始`（pending），而 `bindTemplateToSegment` 只接受 `active` 环节
 * （`GET /projects/:id/overview` 只回当前 active 的那条）。种子里的
 * `FULLSTACK_E2E.agendaSegmentId` 已经是 `active`，且本旅程绑定的是**自己新建、
 * 自己发布**的模板（`journeyTemplateKey`），与 core-loop.spec.ts 步骤 8c 绑的
 * `boundTemplateKey` 是两个不同的 key，两条互不冲突（不同模板绑同一个环节，
 * 不撞任何唯一约束）。
 */
import { expect, test, type Page } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/**
 * 切账号前必须先清掉上一个人的会话——`/login` 在已认证会话下会直接把人弹回
 * `/projects`（不渲染登录表单），`login-email` 因此永远等不到。同
 * core-loop.spec.ts 步骤 5 的既有做法。
 */
async function logout(page: Page): Promise<void> {
  await page.context().clearCookies();
  // 第一次调用时页面可能还停在初始空白页，访问 localStorage 会抛——吞掉，
  // 那种情况下本来就没有会话可清。
  await page.evaluate(() => window.localStorage.clear()).catch(() => {});
}

async function loginAsAdmin(page: Page): Promise<void> {
  await logout(page);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.adminEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function loginAsFacilitator(page: Page): Promise<void> {
  await logout(page);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
}

test("旅程④：管理员新建画布模板 → 加字段（测试）→ 发布 → 引导师在项目里真正绑定使用 → 该项目的 chat 可达", async ({ page }) => {
  test.setTimeout(120_000);
  const unique = Date.now();
  const name = `旅程④模板-${unique}`;

  /* ── ① 新建：只填名字（#1916 简化版流程），建完自动打开编辑面板 ── */
  await loginAsAdmin(page);
  await page.goto("/canvas/template-admin?view=list");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();

  const createResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" && /\/canvas\/templates(\?|$)/.test(response.url())
  ));
  await page.getByTestId("tpladmin-create").click();
  await expect(page.getByTestId("tpladmin-create-dialog")).toBeVisible();
  await page.getByTestId("tpladmin-create-name").fill(name);
  await page.getByTestId("tpladmin-create-submit").click();
  const created = await (await createResponsePromise).json() as { key: string };
  const key = created.key;

  /* ── ② 编辑/测试：加一个字段，保存 ── */
  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  await page.getByTestId("tpladmin-editor-new-key").fill("journey4_field");
  await page.getByTestId("tpladmin-editor-new-name").fill("旅程④字段");
  await page.getByTestId("tpladmin-editor-new-add").click();
  await expect(page.getByTestId("tpladmin-editor-dirty")).toBeVisible();
  // ⚠ 真实实测踩过的坑：按钮离开"正在保存…"这个瞬时态，不代表这次请求真的成功——
  //   之前这里只等按钮文案，`POST .../draft` 服务端 400（真实实测：字段 key 用了
  //   `journey4Field` 这种带大写字母的驼峰，撞上契约 `key: z.string().regex(/^[a-z]
  //   [a-z0-9_]*$/)`）时按钮一样会离开"正在保存…"，让这条用例两次"通过"都是假的——
  //   直到下面 ③ 重开编辑面板核对字段真的还在，才第一次真正测出保存从未成功过。
  //   现在直接断言响应状态，不给这类假绿留空子。
  const saveResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST" && /\/canvas\/templates\/[^/]+\/draft(\?|$)/.test(response.url())
  ));
  await page.getByTestId("tpladmin-editor-save").click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status(), `保存字段应当 2xx，实际 ${saveResponse.status()}：${await saveResponse.text()}`)
    .toBeLessThan(300);
  // 不赛跑保存按钮文案（"正在保存…"→"已保存"）：实测这个派生态（本地字段与
  // `row` 服务端快照逐项比对）偶尔在保存成功后又短暂判回"保存改动"，不是保存本身
  // 失败——但那是**在确认请求已经 2xx 之后**的文案时序问题，与上面的响应状态断言
  // 不是同一件事，两者都要留着。
  await expect(page.getByTestId("tpladmin-editor-save")).not.toHaveText("正在保存…", { timeout: 10_000 });
  await page.getByTestId("tpladmin-editor-close").click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toHaveCount(0);

  // 刷新仍在 = 写进了库（同 core-loop.spec.ts 步骤 4）。
  await page.reload();
  await expect(page.getByTestId(`tpladmin-card-${key}-1`)).toContainText(name);
  // 模板卡片包含名字这件事从创建那一刻起就为真，不能证明"加字段"这一步本身写
  // 对了——重新打开编辑面板，核对刚才加的那个字段真的还在，才是本节"编辑（测试）"
  // 真正要验的东西：字段真的持久化了，不是本地 state 顺手保存了模板的 displayName
  // 却没碰 sections 数组。
  await page.getByTestId(`tpladmin-card-${key}-1`).click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toBeVisible();
  const savedField = page.getByTestId("tpladmin-editor-field-journey4_field");
  await expect(savedField).toBeVisible();
  // 真实实测：新字段默认类型是「便利贴列表」，key 徽标会带 `[]` 后缀渲染成
  // `{{journey4_field[]}}`（`template-editor-panel.tsx` 对 `type === "便利贴列表"`
  // 的专门处理）——只认前缀，不依赖默认类型这个随时可能变的细节。
  await expect(savedField).toContainText("{{journey4_field");
  // 中文名渲染成一个可编辑的 `<input value>`，不是纯文本节点——`toContainText`
  // 读不到 value，必须用 `toHaveValue` 才是真的核对到了这个字段的中文名也存对了，
  // 不是只核对到 key 字面量。
  await expect(savedField.locator("input")).toHaveValue("旅程④字段");
  await page.getByTestId("tpladmin-editor-close").click();
  await expect(page.getByTestId("tpladmin-editor-panel")).toHaveCount(0);
  // 建完只能是**草稿**——发布之前不该出现在"已发布"筛选里，否则下面"发布真的
  // 起了作用"就无法证明（同 canvas-template-create-smoke.spec.ts 的既有纪律）。
  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-card-${key}-1`)).toHaveCount(0);

  /* ── ③ 发布 ── */
  await page.getByTestId("tpladmin-filter-all").click();
  await page.getByTestId(`tpladmin-publish-${key}-1`).click();
  await expect(page.getByTestId(`tpladmin-card-${key}-1`)).toContainText("已发布", { timeout: 10_000 });
  await page.getByTestId("tpladmin-filter-published").click();
  await expect(page.getByTestId(`tpladmin-card-${key}-1`)).toContainText(name);

  /* ── ④ 真正使用：引导师把它绑定到项目里一个真实的（active）议程环节 ──
        「谁能用」判工作坊引导师，不是管理员——同 core-loop.spec.ts 步骤 8c 的既有裁决
        （bind-template-to-segment.ts 文件头），换个人登录才能真的走通这一步。 */
  await loginAsFacilitator(page);
  await page.goto("/canvas/template-admin?view=list");
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();
  const usage = page.getByTestId(`canvas-template-usage-${key}-1`);
  await expect(usage).toHaveText("0");

  await page.getByTestId(`canvas-template-use-${key}-1`).click();
  await page.getByTestId("canvas-template-apply-project").selectOption(FULLSTACK_E2E.projectId);
  await expect(page.getByTestId(`canvas-template-apply-segment-${FULLSTACK_E2E.agendaSegmentId}`))
    .toContainText(FULLSTACK_E2E.agendaSegmentTitle);

  const bindResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && /\/canvas\/agenda-segments\/[^/]+\/template-bindings(\?|$)/.test(response.url())
  ));
  await page.getByTestId("canvas-template-apply").click();
  expect((await bindResponse).status()).toBe(200);
  await expect(usage).toHaveText("1");

  // 刷新后仍是 1 —— 区分「写进 PostgreSQL」与「写进 React state」。
  await page.reload();
  await expect(page.getByTestId("tpladmin-root")).toBeVisible();
  await expect(usage).toHaveText("1");

  /* ── ⑤ 收口：这个刚被绑定使用的模板所属的那个项目，chat 工作区真实可达 ──
        证明"使用"与"chat"不是两个互不相干的孤岛——绑定生效的是同一个项目，
        该项目的会话列表真的能打开、能新建会话。 */
  await page.goto(`/chat?projectId=${FULLSTACK_E2E.projectId}`);
  await expect(page.getByTestId("chat-read-thread-list")).toBeVisible();
  await expect(page.getByTestId("chat-thread-create")).toBeVisible();
});
