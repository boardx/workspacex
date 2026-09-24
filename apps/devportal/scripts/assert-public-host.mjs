// assert-public-host.mjs —— 公开层拆域（D13 / backlog F1）的部署门控。
// 公开主机名唯一事实源：wrangler.toml [vars] DEVPORTAL_PUBLIC_HOST。仍是占位值或缺失 →
// 退出码 1，CD 在部署前大声失败。域名选择与 DNS/Cloudflare 绑定是人类动作（见 README）。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "__SET_DEVPORTAL_PUBLIC_HOST__";
const file = process.argv[2] ?? join(dirname(dirname(fileURLToPath(import.meta.url))), "wrangler.toml");
const src = await readFile(file, "utf8");
const value = /^\s*DEVPORTAL_PUBLIC_HOST\s*=\s*"([^"]*)"/m.exec(src)?.[1]?.trim() ?? "";

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
