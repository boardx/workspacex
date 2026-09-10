import { test, expect, type Locator, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";

/**
 * issue #3373 —— composer 内联附件条在**真实浏览器**里的判据。
 *
 * ## 为什么这条非在真浏览器里跑不可
 *
 * 同一批行为的结构判据（缩略图指向哪个文件 / 点第 2 张打开第 2 张 / 关闭路径 / 只读态）
 * 已由 `apps/web/tests/ui/chat-composer-attachment-strip.test.tsx` 在 jsdom 里钉住，
 * 那份在 PR 上就跑。**这里不重复那些**，只判 jsdom **判不了**的两维：
 *
 *   ① **真的看得见**——jsdom 不做布局，`getBoundingClientRect` 恒 0，命中测试在那边
 *      只会是个恒真或恒假的假门。这里用 `document.elementFromPoint(缩略图中心)`：
 *      尺寸为 0、被祖先 `overflow` 裁掉、被别的元素盖住，三种"几何全绿而用户看不见"
 *      的形状都会红（本仓栽过这个坑：`getBoundingClientRect` 读不出 overflow 裁剪）。
 *   ② **`src` 真的解出了图像字节**——`naturalWidth > 0`。一个 `src` 坏掉的 `<img>`
 *      在 DOM 里长得和好的一模一样，只有真浏览器解过码才知道。
 *
 * ## 「点了第 2 张却打开第 1 张」在这里是怎么钉住的
 *
 * 不靠 id 字符串（那种断言只证明 React 把 state 传对了，不证明**屏幕上那张图**是谁）。
 * 两张图故意做成**不同的内在尺寸**：A 是 4×4，B 是 8×8。放大预览里那个 `<img>` 的
 * `naturalWidth` 是浏览器从真实字节里解出来的，伪造不了——点第 2 张，预览大图的
 * `naturalWidth` 必须是 8。若实现退化成"永远打开第 1 张"，这里读到 4，红。
 */

/** 4×4 红（附件 A）与 8×8 蓝（附件 B）。内在尺寸就是它们的身份。 */
const PNG_A_4X4 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4IycHRwzEcQDTIxGBFNCZswAAAABJRU5ErkJggg==";
const PNG_B_8X8 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOQs7mDFTEMLQkAGQpNgZweqk4AAAAASUVORK5CYII=";

test.setTimeout(120_000);

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/projects$/);
}

/**
 * 命中测试：这个元素中心那一点，浏览器实际命中的是不是它自己（或它的后代）。
 * 返回 `{ hit, naturalWidth, width, height }`——不返回布尔，失败时要能看见到底命中了谁。
 */
async function hitTest(locator: Locator): Promise<{
  hit: boolean; hitTag: string; hitTestId: string | null;
  naturalWidth: number; width: number; height: number;
}> {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const at = document.elementFromPoint(cx, cy);
    return {
      hit: at !== null && (at === el || el.contains(at) || at.contains(el)),
      hitTag: at?.tagName ?? "(none)",
      hitTestId: at?.getAttribute("data-testid") ?? null,
      naturalWidth: (el as HTMLImageElement).naturalWidth ?? 0,
      width: rect.width,
      height: rect.height,
    };
  });
}

test(
  "#3373 composer 内联附件：图片缩略图真的可见（命中测试）+ 点第 2 张打开的是第 2 张",
  async ({ page }) => {
    await login(page);
    await page.goto("/chat");

    // 隐藏文件输入由 `ChatAttachmentDock` 无条件渲染（不挂在「加材料」弹窗开合上），
    // 直接对它 `setInputFiles` 走的就是真实的 `pickFiles → doUpload` 路径，不是绕过它——
    // 与 `chat-vision-honest-degrade.spec.ts` 同一套做法。线程是首次上传时按需创建的
    // （`resolveThreadId`，issue #2520），所以不需要先手工建线程。
    await expect(page.getByTestId("chat-task-workbench-composer")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("chat-attachment-file-input").waitFor({ state: "attached", timeout: 30_000 });

    /* ═══ ① 真实上传两张图 + 一个非图片，走的是真 multipart 端点 ═══ */
    await page.getByTestId("chat-attachment-file-input").setInputFiles([
      { name: "thumb-a.png", mimeType: "image/png", buffer: Buffer.from(PNG_A_4X4, "base64") },
      { name: "thumb-b.png", mimeType: "image/png", buffer: Buffer.from(PNG_B_8X8, "base64") },
      { name: "thumb-note.txt", mimeType: "text/plain", buffer: Buffer.from("#3373 非图片退回类型图标", "utf8") },
    ]);

    const strip = page.getByTestId("chat-attachment-list");
    await expect(strip).toBeVisible();
    const chips = strip.getByRole("listitem");
    await expect(chips).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      await expect(chips.nth(i)).toHaveAttribute("data-status", "uploaded", { timeout: 30_000 });
    }
    await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);

    /* ═══ ② 附件条真的在 composer 卡片**内部**（需求 ①，不是浮在它上面的宽卡片） ═══ */
    const insideComposer = await strip.evaluate(
      (el) => el.closest('[data-testid="chat-task-workbench-composer"]') !== null,
    );
    expect(insideComposer, "附件条必须是 composer 卡片的后代").toBe(true);

    /* ═══ ③ 命中测试：两张缩略图真的看得见，且 src 真的解出了图像字节 ═══ */
    const thumbA = page.getByAltText("thumb-a.png");
    const thumbB = page.getByAltText("thumb-b.png");
    for (const [name, thumb] of [["thumb-a.png", thumbA], ["thumb-b.png", thumbB]] as const) {
      const probe = await hitTest(thumb);
      expect(probe.width, `${name} 缩略图宽度`).toBeGreaterThan(8);
      expect(probe.height, `${name} 缩略图高度`).toBeGreaterThan(8);
      // src 坏掉 / 还没解码完 → naturalWidth 为 0。这是"有个 img 元素"抓不到的那一档。
      expect(probe.naturalWidth, `${name} 必须真的解出了图像字节`).toBeGreaterThan(0);
      // 被祖先 overflow 裁掉、被别的层盖住 → 中心那一点命中的是别人。
      expect(
        probe.hit,
        `${name} 中心点命中的是 <${probe.hitTag} data-testid=${probe.hitTestId}>，不是缩略图本身`,
      ).toBe(true);
    }

    /* ═══ ④ 非图片：不假装有缩略图，退回类型图标 + 文件名（但不是那张宽卡片） ═══ */
    const noteChip = chips.filter({ hasText: "thumb-note.txt" });
    await expect(noteChip).toHaveCount(1);
    await expect(noteChip).toHaveAttribute("data-kind", "text");
    await expect(noteChip.locator("img")).toHaveCount(0);

    /* ═══ ⑤ 点**第 2 张** → 放大预览打开的必须是第 2 张 ═══ */
    await expect(page.getByTestId("chat-attachment-draft-preview-body")).toHaveCount(0);
    await thumbB.click();

    const previewBody = page.getByTestId("chat-attachment-draft-preview-body");
    await expect(previewBody).toBeVisible();
    await expect(previewBody).toHaveAttribute("data-preview-filename", "thumb-b.png");

    const previewImg = page.getByTestId("chat-attachment-draft-preview-image");
    await expect(previewImg).toBeVisible();
    const previewProbe = await hitTest(previewImg);
    // 核心：屏幕上那张大图的**字节**是 8×8 那一张。退化成"永远打开第 1 张"时这里是 4。
    expect(previewProbe.naturalWidth, "预览显示的必须是第 2 张（8×8），不是第 1 张（4×4）").toBe(8);
    expect(previewProbe.hit, "预览大图必须真的可见").toBe(true);

    /* ═══ ⑥ 关闭方式可达：Esc ═══ */
    await page.keyboard.press("Escape");
    await expect(previewBody).toHaveCount(0);

    /* ═══ ⑦ 对照：点第 1 张打开的是第 1 张（4×4）——证明 ⑤ 不是碰巧 ═══ */
    await thumbA.click();
    await expect(page.getByTestId("chat-attachment-draft-preview-body"))
      .toHaveAttribute("data-preview-filename", "thumb-a.png");
    expect(
      (await hitTest(page.getByTestId("chat-attachment-draft-preview-image"))).naturalWidth,
    ).toBe(4);
    await page.getByTestId("chat-attachment-draft-preview-dismiss").click();
    await expect(page.getByTestId("chat-attachment-draft-preview-body")).toHaveCount(0);

    /* ═══ ⑧ 移除按钮真的移除（没有点了没反应的东西） ═══ */
    const bChipTestId = await chips.filter({ has: page.getByAltText("thumb-b.png") })
      .getAttribute("data-testid");
    const localId = bChipTestId!.replace("chat-attachment-chip-", "");
    await page.getByTestId(`chat-attachment-remove-${localId}`).click();
    await expect(strip.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByAltText("thumb-b.png")).toHaveCount(0);
  },
);
