import { test, expect } from "@playwright/test";

/**
 * UC-0.4 R12 V9 —— 响应式：375 / 768 / 1280 三档不得出现横向溢出
 * （uiux-standards U8；一致性复核 N-7 补上的自动化覆盖）
 *
 * ## 为什么这条必须用真实浏览器
 * 横向溢出是**布局计算的结果**，不是 HTML 结构的属性——
 * 同一份 DOM 在不同视口宽度下溢出与否完全不同，只有真实渲染后量 `scrollWidth` 才知道。
 * 这也是本项目唯一需要浏览器的断言；其余门控都用「对 SSR 的 HTML 断言 testid」，更稳更快。
 */

/** 三档来自 uiux-standards U8；名字用于报错时一眼看出是哪档 */
const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
] as const;

/** 覆盖所有已建成的业务屏——新增屏要加进来（与 verify-ui-states.sh 的 SCREENS 同源问题，见 G-4） */
const SCREENS = [
  "/", "/kitchen-sink",
  "/login", "/join", "/consent", "/group", "/session",
  "/chat", "/projects", "/projects/p1", "/projects/p1/canvas", "/projects/p1/files",
  "/tasks", "/brain", "/profile", "/org-admin",
  "/admin", "/admin/agent", "/admin/skill", "/admin/model",
  "/admin/mcp", "/admin/members", "/admin/feedback",
  "/studio/prototype", "/studio/interview", "/studio/survey", "/studio/research",
  "/studio/interview/i-wang?tab=design", "/studio/interview/i-wang?tab=respondents",
  "/studio/interview/i-wang?tab=record", "/studio/interview/i-wang?tab=insight",
  "/studio/interview?tab=templates",
];

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name}（${vp.width}px）`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const path of SCREENS) {
      test(`${path} 无横向溢出`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });

        const result = await page.evaluate(() => {
          const doc = document.documentElement;
          /**
           * ⚠ 只查 `documentElement.scrollWidth` 是**不够的**——本项目第一版就栽在这。
           *
           * `AppShell` 外层是 `overflow-hidden`：内容再宽也被裁掉，
           * 文档级 scrollWidth 恒等于视口宽，断言**永远通过**。
           * 塞一个 900px 的元素进去实测，它照样绿——那就是空转的门控。
           *
           * 真正要查的是「**内容被裁掉且用户无法看到**」：
           * 某个容器 scrollWidth > clientWidth（内容比它宽）
           * 且 overflow-x 为 hidden/clip（没有滚动条可以看到剩下的）。
           * overflow-x 是 auto/scroll 的容器是**合法**的——用户能横向滚动看全，
           * 那是设计（宽表格、代码块），不是缺陷。
           */
          const docOverflow = doc.scrollWidth - window.innerWidth;

          /**
           * ⚠ 第二版仍有一个洞：只查 `overflow-x: hidden` 的容器。
           * 但 `<main className="overflow-y-auto">` 会被 CSS **隐式**把 overflow-x 算成 auto——
           * 于是「主内容列在 375 下需要横向滚动」这种真缺陷被当成「可滚动是合法的」放过了。
           * 实测：塞一个 900px 的元素进 main，第二版照样绿。
           *
           * ⇒ 第三版改为：**任何**横向内容超出容器的元素都算缺陷，
           *   除非它带 `data-allow-x-scroll` —— 把「这里的横向滚动是设计」变成**显式声明**，
           *   而不是从 computed style 去猜。意图应当写出来，不该被推断。
           */
          const clipped: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>("*")) {
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            /**
             * ⚠ `overflow-x: visible` 的元素**不裁内容**——它只是溢出到父级去渲染。
             * 内容是否真的不可达，取决于**某个祖先有没有裁它**，而那个祖先会被单独检查到。
             * 在这里报它只会重复报同一处溢出，还会因为 2px 的文本外溢产生噪音
             * （实测 /admin/skill 就是这样误报的）。
             * ⇒ 只查会**裁**（hidden/clip）或需要**滚**（auto/scroll）的容器。
             */
            if (cs.overflowX === "visible") continue;
            // 显式声明「此处横向滚动是设计」的放行（如画布需平移、宽表格）
            if (el.closest("[data-allow-x-scroll]")) continue;
            // `.sr-only` 与其它视觉隐藏：本就是 1px + overflow hidden，是标准无障碍模式
            if (el.classList.contains("sr-only")) continue;
            if (el.clientWidth <= 1 && el.clientHeight <= 1) continue;
            // 刻意的单行截断（Tailwind `truncate`）是设计，不是内容不可达
            if (cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap") continue;
            const over = el.scrollWidth - el.clientWidth;
            if (over <= 1) continue;
            const cls = (el.className || "").toString().slice(0, 70);
            const tid = el.getAttribute("data-testid");
            clipped.push(
              `${el.tagName}${tid ? `[${tid}]` : `.${cls}`} → 超出 ${over}px` +
                `（scrollW=${el.scrollWidth} clientW=${el.clientWidth} overflow-x=${cs.overflowX}）`,
            );
            if (clipped.length >= 5) break;
          }
          return { docOverflow, vw: window.innerWidth, scrollW: doc.scrollWidth, clipped };
        });

        expect(
          result.docOverflow,
          `页面产生了横向滚动 ${result.docOverflow}px（视口 ${result.vw}，文档 ${result.scrollW}）`,
        ).toBeLessThanOrEqual(1);

        expect(
          result.clipped,
          result.clipped.length
            ? `有内容横向超出容器（被裁掉、或需要横向滚动才能看全）：\n  ${result.clipped.join("\n  ")}\n` +
                `若某处的横向滚动确实是设计（画布平移、宽表格），请在该元素加 data-allow-x-scroll="理由"。`
            : "",
        ).toEqual([]);
      });
    }
  });
}
