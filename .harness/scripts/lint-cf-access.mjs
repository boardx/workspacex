#!/usr/bin/env node
/**
 * lint-cf-access.mjs —— Cloudflare Access 的仓库侧门禁（backlog D7 + D6 仓库半边）。
 *
 * 清单：docs/deployment/cloudflare-access-inventory.json（哪些 app / host / path 该在 Access 后）。
 * 校验实现：packages/coord-access（唯一一份；缺 AUD / 团队域名 fail-closed）。
 *
 * 查什么：
 *   ① 每个带 wrangler.toml 的 apps/* 都在清单里登记（protected / public）；清单里的 app 必须存在；
 *   ② protected：package.json 依赖 @repo/coord-access、源码 import 它、wrangler.toml 声明
 *      aud_var / team_var（占位值可）、至少一条 host 标 behind_access=true；
 *   ③ 源码里出现 Access 信号（读 cf-access-jwt-assertion 头 / 声明 *ACCESS_AUD 变量）的 app 必须是 protected；
 *   ④ 单一实现：coord-access 之外不得自己拉 Access 证书端点或对 Access JWT 验签（防再长出第二份）。
 * 扫到 0 个 app 判失败：空集不是全绿。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const INVENTORY = "docs/deployment/cloudflare-access-inventory.json";
const PKG = "@repo/coord-access";
const SHARED_DIR = "packages/coord-access";
const SRC_EXT = /\.(m?[jt]sx?)$/;
const SKIP = new Set(["node_modules", ".next", ".vercel", "dist", ".wrangler", "test", "tests", "e2e", "__tests__"]);

function walk(dir, out = []) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e) || e.startsWith(".")) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SRC_EXT.test(e) && !/\.(test|spec)\./.test(e)) out.push(p);
  }
  return out;
}

/** wrangler.toml 中未注释的 `NAME = ...` 行。 */
const declaresVar = (toml, name) => new RegExp(`^\\s*${name}\\s*=`, "m").test(toml);

export function checkCfAccess(root) {
  const errors = [];
  const invPath = join(root, INVENTORY);
  if (!existsSync(invPath)) return { errors: [`缺清单 ${INVENTORY}`], apps: [] };
  let inv;
  try { inv = JSON.parse(readFileSync(invPath, "utf8")); } catch (e) { return { errors: [`${INVENTORY} 不是合法 JSON：${e.message}`], apps: [] }; }
  const entries = inv.apps ?? {};

  const appsDir = join(root, "apps");
  const wranglerApps = existsSync(appsDir)
    ? readdirSync(appsDir).filter((a) => existsSync(join(appsDir, a, "wrangler.toml"))).map((a) => `apps/${a}`)
    : [];
  if (wranglerApps.length === 0) errors.push("扫到 0 个带 wrangler.toml 的 app——空集不是全绿");

  for (const app of wranglerApps) if (!entries[app]) errors.push(`${app}：有 wrangler.toml 但未在 ${INVENTORY} 登记（protected / public）`);
  for (const app of Object.keys(entries)) if (!existsSync(join(root, app, "wrangler.toml"))) errors.push(`${app}：清单登记了但没有 wrangler.toml`);

  for (const app of wranglerApps) {
    const e = entries[app];
    const toml = readFileSync(join(root, app, "wrangler.toml"), "utf8");
    const files = walk(join(root, app));
    const srcs = files.map((f) => [relative(root, f), readFileSync(f, "utf8")]);
    const readsHeader = srcs.some(([, s]) => /cf-access-jwt-assertion/i.test(s));
    const declaresAud = /^\s*[A-Z_]*ACCESS_AUD\s*=/m.test(toml);
    if (!e) continue;
    if (e.access !== "protected" && e.access !== "public") { errors.push(`${app}：access 必须是 protected 或 public`); continue; }
    if (e.access === "public") {
      if (readsHeader || declaresAud) errors.push(`${app}：登记为 public，但源码/配置有 Access 信号（读 Cf-Access-Jwt-Assertion 或声明 ACCESS_AUD）——改登记为 protected`);
      if ((e.hosts ?? []).some((h) => h.behind_access)) errors.push(`${app}：public 应用不应有 behind_access=true 的 host`);
      continue;
    }
    // protected
    const pkgPath = join(root, app, "package.json");
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf8")) : {};
    if (!pkg.dependencies?.[PKG]) errors.push(`${app}：protected 但 package.json dependencies 未声明 ${PKG}`);
    if (!srcs.some(([, s]) => s.includes(`"${PKG}"`) || s.includes(`'${PKG}'`))) errors.push(`${app}：protected 但源码未 import ${PKG}（Access 校验必须走共享实现）`);
    for (const k of ["aud_var", "team_var"]) {
      if (!e[k]) errors.push(`${app}：清单缺 ${k}`);
      else if (!declaresVar(toml, e[k])) errors.push(`${app}：wrangler.toml 未声明 ${e[k]}（占位值即可，运行时 fail-closed）`);
    }
    if (!(e.hosts ?? []).some((h) => h.behind_access === true)) errors.push(`${app}：protected 但没有任何 behind_access=true 的 host/path`);
  }

  // ④ 单一实现
  const scanRoots = ["apps", "packages"].flatMap((d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).map((x) => `${d}/${x}`) : []));
  for (const dir of scanRoots) {
    if (dir === SHARED_DIR) continue;
    for (const f of walk(join(root, dir))) {
      const s = readFileSync(f, "utf8");
      const rel = relative(root, f);
      if (s.includes("cdn-cgi/access/certs")) errors.push(`${rel}：自己拉 Access 证书端点——校验只许在 ${SHARED_DIR}`);
      else if (/cf-access-jwt-assertion/i.test(s) && /(crypto\.subtle\.verify|jwtVerify)\s*\(/.test(s)) errors.push(`${rel}：自己对 Access JWT 验签——改用 ${PKG}`);
    }
  }
  return { errors, apps: wranglerApps };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const { errors, apps } = checkCfAccess(root);
  if (errors.length) {
    console.error(`✗ lint-cf-access：${errors.length} 处\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`✓ lint-cf-access：${apps.length} 个 wrangler app 均已登记，protected 应用全部走 ${PKG} 且声明 AUD/团队域名`);
}
