// 截图生成器 —— chat-file-upload 束（V9 文件上传）的 composer 附件六态原型。
// ADR-023 签核第 ① 件（UI）材料。纯 mock 原型页 /preview/chat-file-upload，不接后端。
//
// 用法：BASE=http://localhost:3131 OUT=/abs/path node scripts/shot-chat-file-upload.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3131";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 900, height: 1000 };
const ROOT = '[data-testid="chat-file-upload-preview"]';

/** [file, scene] —— 文件名遵循 <uc-id>-<屏名>-<状态>.png（束 = V9 composer 附件） */
const SHOTS = [
  ["v9-composer-attach-default.png", "default"],
  ["v9-composer-attach-dragover.png", "dragover"],
  ["v9-composer-attach-attached.png", "attached"],
  ["v9-composer-attach-uploading.png", "uploading"],
  ["v9-composer-attach-error-oversize.png", "error-oversize"],
  ["v9-composer-attach-error-type.png", "error-type"],
  ["v9-composer-attach-error-count.png", "error-count"],
  ["v9-composer-attach-error-retry.png", "error-retry"],
  ["v9-composer-attach-remove-confirm.png", "remove-confirm"],
];

async function gotoUntilReady(page, url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(ROOT, { state: "attached", timeout: 8000 });
      return true;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`root ${ROOT} never rendered for ${url}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let n = 0;
for (const [file, scene] of SHOTS) {
  await gotoUntilReady(page, `/preview/chat-file-upload?scene=${scene}`);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  n++;
  process.stdout.write(`  ✓ ${file}\n`);
}
await browser.close();
console.log(`done: ${n} screenshots → ${OUT}`);
