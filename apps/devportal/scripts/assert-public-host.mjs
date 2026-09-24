// assert-public-host.mjs —— 公开层拆域（D13 / backlog F1）的部署门控。
// 公开主机名唯一事实源：wrangler.toml [vars] DEVPORTAL_PUBLIC_HOST。仍是占位值或缺失 →
// 退出码 1，CD 在部署前大声失败。域名选择与 DNS/Cloudflare 绑定是人类动作（见 README）。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "__SET_DEVPORTAL_PUBLIC_HOST__";
const args = process.argv.slice(2);
// 域名未选定前 CD 用 --allow-placeholder：拆分保持未启用（路由与拆分前一致），只发警告，不阻断部署。
const allowPlaceholder = args.includes("--allow-placeholder");
const file = args.find((a) => !a.startsWith("--")) ?? join(dirname(dirname(fileURLToPath(import.meta.url))), "wrangler.toml");
const src = await readFile(file, "utf8");
const value = /^\s*DEVPORTAL_PUBLIC_HOST\s*=\s*"([^"]*)"/m.exec(src)?.[1]?.trim() ?? "";

if (allowPlaceholder && value === PLACEHOLDER) {
  console.log(`::warning title=公开层拆域未启用::DEVPORTAL_PUBLIC_HOST 仍是占位值，拆分未生效（路由与拆分前一致）。人类选定公开域名后填入 wrangler.toml 并去掉 --allow-placeholder。`);
  process.exit(0);
}
if (!value || value === PLACEHOLDER) {
  console.error(
    `✗ DEVPORTAL_PUBLIC_HOST 未配置（当前：${value || "<缺失>"}）。\n` +
      "  公开层拆域（D13）要求在 apps/devportal/wrangler.toml [vars] 填入人类选定的公开域名，\n" +
      "  并在 Cloudflare 绑定该自定义域（不挂 Access）。见 apps/devportal/README.md「公开层拆域」。",
  );
  process.exit(1);
}
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
  console.error(`✗ DEVPORTAL_PUBLIC_HOST 不是合法主机名（不要带协议/路径/端口）：${value}`);
  process.exit(1);
}
console.log(`✓ DEVPORTAL_PUBLIC_HOST = ${value}`);
