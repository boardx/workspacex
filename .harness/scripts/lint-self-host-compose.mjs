#!/usr/bin/env node
/**
 * 自托管根 compose 的机械门（backlog E7）。零依赖：干净 clone、无 node_modules 也能跑。
 *
 * 核对 compose.yaml：
 *   ① 只组合不定义：没有顶层 services:，include 列表**非空**（空集判红，不是放行）；
 *   ② 每个 include 的文件真实存在；
 *   ③ 不得 include 内部运营平面（OPS_DIRS 唯一事实源：lib/ops-plane.mjs）——文件路径、
 *      build context、extends file 都不许落进运营目录，服务名也不许撞运营目录名；
 *   ④ 不得 include 会清库的 dev compose（tmpfs PG）；
 *   ⑤ include 进来的文件里每个 `${VAR:?…}` 必填变量都出现在 selfhost.env.example；
 *   ⑥ scripts/upgrade.sh 语法正确（bash -n）；
 *   ⑦ 有 docker 时跑真正的 `docker compose config`；没有 docker 明确打印 SKIP（①–⑥ 照跑）。
 *
 * 反证：lint-self-host-compose.selftest.mjs（node --test）逐条构造违规断言会红。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { OPS_DIRS, expandOpsDirs } from "./lib/ops-plane.mjs";

const FORBIDDEN_INCLUDES = ["apps/api/docker-compose.dev.yml"];

const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");

/** 取 compose.yaml 顶层 include: 下的路径（支持 `- path: x` 与 `- x` 两种写法）。 */
export function parseIncludes(text) {
  const lines = text.split("\n");
  const out = [];
  let inInclude = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\S/.test(line)) { inInclude = /^include:\s*$/.test(line); continue; }
    if (!inInclude) continue;
    let m = line.match(/^\s*-\s*path:\s*(.+)$/) || line.match(/^\s*-\s*(?!\w+:)(.+)$/);
    if (m) out.push(unquote(m[1]));
  }
  return out;
}

/** 顶层 services: 下的服务名。 */
export function parseServiceNames(text) {
  const names = [];
  let inServices = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) { inServices = /^services:\s*$/.test(line); continue; }
    const m = inServices && line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (m) names.push(m[1]);
  }
  return names;
}

export function checkSelfHostCompose(root, { docker = true } = {}) {
  const errors = [];
  const notes = [];
  const composePath = join(root, "compose.yaml");
  if (!existsSync(composePath)) return { errors: ["compose.yaml 不存在"], notes };
  const compose = readFileSync(composePath, "utf8");

  if (/^services:/m.test(compose)) errors.push("compose.yaml 定义了顶层 services: —— 只许 include，不许复制服务定义");
  const includes = parseIncludes(compose);
  if (includes.length === 0) errors.push("compose.yaml 的 include 列表为空（空集不是通过）");

  const opsDirs = expandOpsDirs(root, readdirSync, existsSync, join, dirname);
  const opsNames = new Set(opsDirs.map((d) => d.split("/").pop()));
  const inOps = (abs) => {
    const rel = relative(root, abs).split(sep).join("/");
    return opsDirs.some((d) => rel === d || rel.startsWith(`${d}/`)) ||
      OPS_DIRS.some((p) => p.endsWith("*") && rel.startsWith(p.slice(0, -1)));
  };

  const envExamplePath = join(root, "selfhost.env.example");
  const envExample = existsSync(envExamplePath) ? readFileSync(envExamplePath, "utf8") : null;
  if (envExample === null) errors.push("selfhost.env.example 不存在");
  const declared = new Set((envExample ?? "").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1]).filter(Boolean));

  for (const inc of includes) {
    const abs = resolve(root, inc);
    const rel = relative(root, abs).split(sep).join("/");
    if (!existsSync(abs)) { errors.push(`include 的文件不存在：${inc}`); continue; }
    if (inOps(abs)) errors.push(`include 了运营平面文件：${rel}`);
    if (FORBIDDEN_INCLUDES.includes(rel)) errors.push(`include 了会清库的 dev compose：${rel}`);
    const text = readFileSync(abs, "utf8");
    for (const name of parseServiceNames(text)) {
      if (opsNames.has(name) || OPS_DIRS.some((p) => p.endsWith("*") && name.startsWith(p.split("/").pop().slice(0, -1)))) {
        errors.push(`${rel} 的服务 ${name} 与运营平面目录同名`);
      }
    }
    for (const m of text.matchAll(/^\s*(?:context|file):\s*(.+)$/gm)) {
      const target = resolve(dirname(abs), unquote(m[1]));
      if (inOps(target)) errors.push(`${rel} 引用了运营平面路径：${unquote(m[1])}`);
    }
    for (const m of text.matchAll(/\$\{([A-Z0-9_]+):\?/g)) {
      if (!declared.has(m[1])) errors.push(`${rel} 的必填变量 ${m[1]} 没出现在 selfhost.env.example`);
    }
  }

  const upgrade = join(root, "scripts/upgrade.sh");
  if (!existsSync(upgrade)) errors.push("scripts/upgrade.sh 不存在");
  else {
    const r = spawnSync("bash", ["-n", upgrade], { encoding: "utf8" });
    if (r.status !== 0) errors.push(`scripts/upgrade.sh 语法错误：${r.stderr.trim()}`);
  }

  if (docker && errors.length === 0) {
    const v = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
    if (v.error || v.status !== 0) {
      notes.push("SKIP docker compose config：本机没有 docker compose（纯 node 检查①–⑥已跑）");
    } else {
      const r = spawnSync("docker", ["compose", "--env-file", envExamplePath, "-f", composePath, "config", "--quiet"],
        { encoding: "utf8", cwd: root });
      if (r.status !== 0) errors.push(`docker compose config 失败：${(r.stderr || r.stdout).trim()}`);
      else notes.push("docker compose config 解析通过");
    }
  }
  return { errors, notes, includes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const { errors, notes, includes } = checkSelfHostCompose(root);
  for (const n of notes) console.log(`  ${n}`);
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    process.exit(1);
  }
  console.log(`✓ compose.yaml：${includes.length} 个 include，均存在、无运营平面、必填变量齐全`);
}
