#!/usr/bin/env node
// fill-legal-placeholders.mjs —— 把开源法务占位一次性替换成组织决定的真实值。
// 文档：docs/deployment/open-source-human-actions.md 第 2 项。
//
//   node scripts/fill-legal-placeholders.mjs --name "<权利人正式名称>" --email <商标联系邮箱> \
//        [--security-email <安全联系邮箱>] [--notice] [--dry-run]
//
// 做什么：
//   · 〔待定：权利人法定名称〕 → --name；〔待定：商标联系邮箱〕 → --email（TRADEMARKS.md 等）；
//   · --security-email：把现有安全联系地址（CURRENT_SECURITY_EMAIL）在 SECURITY.md 与
//     apps/home 站点（security.txt、隐私页、中文文案）里一起换掉——这几处由 check-deploy.mjs 核对一致，
//     只改一处会红；与现值相同则跳过；
//   · --notice：根目录没有 NOTICE 时按 Apache-2.0 惯例生成（已有则不动）；
//   · TRADEMARKS.md 开头那段「本文件里凡是〔待定…〕都是占位」的警示在全部替换后一并删除。
// 只扫 git 跟踪的文本文件；历史记录类文档（docs/research、REVIEW-LOG）只是在「讲」占位，不改。
// --dry-run 只打印将改哪些文件、各几处，不写盘。退出码：0 成功；2 参数错误。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURRENT_SECURITY_EMAIL = "security@boardx.us";
const SECURITY_FILES = [
  "SECURITY.md",
  "apps/home/.well-known/security.txt",
  "apps/home/privacy.html",
  "apps/home/zh/privacy.html",
  "apps/home/assets/js/zh.js",
];
const SKIP_PREFIXES = ["docs/research/", "apps/home/docs/REVIEW-LOG.md", "scripts/fill-legal-placeholders"];
const WARNING_BLOCK = /\n> ⚠ 本文件里凡是 `〔待定：…〕` 的地方[^\n]*\n> [^\n]*\n/;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const dry = process.argv.includes("--dry-run");
const wantNotice = process.argv.includes("--notice");
const name = arg("--name")?.trim();
const email = arg("--email")?.trim();
const securityEmail = arg("--security-email")?.trim();

const EMAIL_RE = /^[^\s@<>〔〕]+@[^\s@<>〔〕]+\.[^\s@<>〔〕]+$/;
const errs = [];
if (!name) errs.push("缺 --name");
else if (/[<>〔〕]/.test(name) || name.includes("待定")) errs.push("--name 看起来还是占位值");
if (!email || !EMAIL_RE.test(email)) errs.push("--email 缺失或不是邮箱");
if (securityEmail !== undefined && !EMAIL_RE.test(securityEmail)) errs.push("--security-email 不是邮箱");
if (errs.length) {
  console.error(errs.map((e) => `✗ ${e}`).join("\n"));
  console.error('用法：node scripts/fill-legal-placeholders.mjs --name "<权利人正式名称>" --email <邮箱> [--security-email <邮箱>] [--notice] [--dry-run]');
  process.exit(2);
}

const REPLACEMENTS = [
  ["〔待定：权利人法定名称〕", name],
  ["〔待定：商标联系邮箱〕", email],
];

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
const changes = [];

for (const rel of tracked) {
  if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
  if (!/\.(md|txt|html|js|mjs|ts|json|yaml|yml|toml)$/.test(rel) && !/^(NOTICE|LICENSE)$/.test(rel)) continue;
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const before = readFileSync(abs, "utf8");
  let after = before;
  let count = 0;
  for (const [from, to] of REPLACEMENTS) {
    const n = after.split(from).length - 1;
    if (n) { after = after.split(from).join(to); count += n; }
  }
  if (securityEmail && securityEmail !== CURRENT_SECURITY_EMAIL && SECURITY_FILES.includes(rel)) {
    const n = after.split(CURRENT_SECURITY_EMAIL).length - 1;
    if (n) { after = after.split(CURRENT_SECURITY_EMAIL).join(securityEmail); count += n; }
  }
  if (rel === "TRADEMARKS.md" && !REPLACEMENTS.some(([from]) => after.includes(from))) after = after.replace(WARNING_BLOCK, "");
  if (after !== before) changes.push({ rel, abs, after, count });
}

const noticePath = join(ROOT, "NOTICE");
const noticeBody = `WorkSpaceX\nCopyright ${new Date().getUTCFullYear()} ${name}\n\nThis product includes software developed by ${name}.\nLicensed under the Apache License, Version 2.0 (see LICENSE).\n`;
const createNotice = wantNotice && !existsSync(noticePath);

for (const c of changes) console.log(`${dry ? "[dry-run] " : ""}改 ${c.rel}（${c.count} 处占位）`);
if (createNotice) console.log(`${dry ? "[dry-run] " : ""}新建 NOTICE`);
else if (wantNotice) console.log("NOTICE 已存在，未改动");
if (!changes.length && !createNotice) console.log("没有需要替换的占位（可能已经填过）");

if (!dry) {
  for (const c of changes) writeFileSync(c.abs, c.after);
  if (createNotice) writeFileSync(noticePath, noticeBody);
  let left = "";
  try {
    left = execFileSync("git", ["grep", "-n", "〔待定", "--", ".", ":!docs/research", ":!scripts/fill-legal-placeholders.mjs"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch { /* git grep 无命中时退出 1 = 已清空 */ }
  console.log(left ? `⚠ 仍有占位：\n${left}` : "✓ 仓库内（历史记录文档除外）已无 〔待定 占位");
}
