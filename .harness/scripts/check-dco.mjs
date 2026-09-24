#!/usr/bin/env node
/**
 * check-dco.mjs —— 逐个 commit 检查 DCO 签署（决策 D20：用 DCO，不用 CLA）。
 *
 * 每个非 merge commit 的说明里必须有 `Signed-off-by: 姓名 <邮箱>`，且**邮箱与提交作者一致**
 * （忽略大小写）。签的是别人的邮箱，等于替别人做了 DCO 声明——那不算签。
 *
 * 范围内 0 个 commit 判失败：一个 PR 至少有一个提交，0 个只能说明范围算错了，
 * 而范围算错时报绿正是本仓反复栽的「空集全绿」。
 *
 * 用法：
 *   node .harness/scripts/check-dco.mjs --range <base>..<head>
 */
import { execFileSync } from "node:child_process";

const ri = process.argv.indexOf("--range");
const range = ri > -1 ? process.argv[ri + 1] : "origin/main..HEAD";
const git = (args) => execFileSync("git", args, { encoding: "utf8" });

const shas = git(["rev-list", "--no-merges", range]).split("\n").filter(Boolean);
const bad = [];
for (const sha of shas) {
  const [email, subject, ...body] = git(["show", "-s", "--format=%ae%n%s%n%B", sha]).split("\n");
  const signers = body.join("\n").match(/^Signed-off-by:\s*.+?<([^>]+)>\s*$/gim) ?? [];
  const emails = signers.map((l) => /<([^>]+)>/.exec(l)[1].toLowerCase());
  if (!emails.includes(email.toLowerCase())) {
    bad.push(`${sha.slice(0, 12)}  ${subject}\n    ${signers.length ? `签署邮箱 ${emails.join(", ")} 与作者 ${email} 不一致` : "没有 Signed-off-by"}`);
  }
}

console.log(`DCO 检查：范围 ${range}，非 merge 提交 ${shas.length} 个，未签署 ${bad.length} 个`);
if (shas.length === 0) {
  console.error("范围内 0 个提交——一个 PR 至少有一个提交，多半是范围算错了；不许判绿。");
  process.exit(1);
}
if (bad.length) {
  for (const b of bad) console.error(`  ${b}`);
  console.error("\n补签：git rebase --signoff <base> && git push --force-with-lease（说明见 CONTRIBUTING.md）");
  process.exit(1);
}
console.log("✅ 每个提交都有与作者一致的 DCO 签署");
