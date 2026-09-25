// 反证：lint-self-host-compose 的每条规则都能红（node --test，零依赖）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSelfHostCompose, parseIncludes } from "./lint-self-host-compose.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fixture({ compose, files = {}, env = "A=1\n", upgrade = "#!/bin/bash\necho ok\n" }) {
  const root = mkdtempSync(join(tmpdir(), "selfhost-compose-"));
  const put = (p, c) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), c); };
  put("compose.yaml", compose);
  put("selfhost.env.example", env);
  if (upgrade !== null) put("scripts/upgrade.sh", upgrade);
  for (const [p, c] of Object.entries(files)) put(p, c);
  return root;
}
const svc = (name, extra = "") => `services:\n  ${name}:\n    image: x${extra}\n`;
const run = (root) => checkSelfHostCompose(root, { docker: false }).errors;

test("真实仓库通过（纯 node 部分）", () => {
  assert.deepEqual(run(REPO), []);
});

test("parseIncludes 两种写法", () => {
  assert.deepEqual(parseIncludes("name: x\ninclude:\n  - path: a.yml\n  - b.yml # c\nvolumes: {}\n"), ["a.yml", "b.yml"]);
});

test("合法 fixture 通过", () => {
  assert.deepEqual(run(fixture({ compose: "include:\n  - path: apps/a/c.yml\n", files: { "apps/a/c.yml": svc("pg") } })), []);
});

test("空 include 判红", () => {
  assert.match(run(fixture({ compose: "name: x\n" })).join(), /为空/);
});

test("被 include 的文件不存在判红", () => {
  assert.match(run(fixture({ compose: "include:\n  - path: apps/nope.yml\n" })).join(), /不存在/);
});

test("复制服务定义判红", () => {
  const root = fixture({ compose: "include:\n  - path: apps/a/c.yml\nservices:\n  pg:\n    image: x\n", files: { "apps/a/c.yml": svc("pg") } });
  assert.match(run(root).join(), /顶层 services/);
});

test("include 运营平面文件判红", () => {
  const root = fixture({ compose: "include:\n  - path: apps/coord-gateway/c.yml\n", files: { "apps/coord-gateway/c.yml": svc("gw") } });
  assert.match(run(root).join(), /运营平面文件/);
});

test("build context 指向运营平面判红", () => {
  const root = fixture({
    compose: "include:\n  - path: apps/a/c.yml\n",
    files: { "apps/a/c.yml": "services:\n  x:\n    build:\n      context: ../devportal\n", "apps/devportal/Dockerfile": "" },
  });
  assert.match(run(root).join(), /引用了运营平面路径/);
});

test("服务名撞运营目录判红", () => {
  const root = fixture({ compose: "include:\n  - path: apps/a/c.yml\n", files: { "apps/a/c.yml": svc("coord-worker") } });
  assert.match(run(root).join(), /运营平面目录同名/);
});

test("include dev compose 判红", () => {
  const root = fixture({ compose: "include:\n  - path: apps/api/docker-compose.dev.yml\n", files: { "apps/api/docker-compose.dev.yml": svc("pg") } });
  assert.match(run(root).join(), /dev compose/);
});

test("必填变量缺样例判红", () => {
  const root = fixture({ compose: "include:\n  - path: apps/a/c.yml\n", files: { "apps/a/c.yml": svc("pg", "\n    environment:\n      P: ${SECRET_X:?set}") } });
  assert.match(run(root).join(), /SECRET_X/);
});

test("upgrade.sh 缺失或语法错判红", () => {
  const base = { compose: "include:\n  - path: apps/a/c.yml\n", files: { "apps/a/c.yml": svc("pg") } };
  assert.match(run(fixture({ ...base, upgrade: null })).join(), /upgrade.sh 不存在/);
  assert.match(run(fixture({ ...base, upgrade: "if then fi\n" })).join(), /语法错误/);
});
