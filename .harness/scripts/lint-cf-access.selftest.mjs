// 反证：lint-cf-access 的每条规则都能红（node --test，零依赖）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCfAccess, INVENTORY } from "./lint-cf-access.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const protectedEntry = { access: "protected", aud_var: "ACCESS_AUD", team_var: "ACCESS_TEAM_DOMAIN", hosts: [{ host: "x", paths: ["/*"], behind_access: true }] };
const goodApp = {
  "apps/ops/wrangler.toml": '[vars]\nACCESS_TEAM_DOMAIN = ""\nACCESS_AUD = ""\n',
  "apps/ops/package.json": JSON.stringify({ dependencies: { "@repo/coord-access": "workspace:*" } }),
  "apps/ops/src/index.ts": 'import { checkAccess } from "@repo/coord-access";\n',
};

function fixture({ files = goodApp, apps = { "apps/ops": protectedEntry }, extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cf-access-"));
  const put = (p, c) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), c); };
  put(INVENTORY, JSON.stringify({ apps }));
  for (const [p, c] of Object.entries({ ...files, ...extra })) put(p, c);
  return root;
}
const run = (o) => checkCfAccess(fixture(o)).errors.join("\n");

test("真实仓库通过", () => assert.deepEqual(checkCfAccess(REPO).errors, []));
test("合法 fixture 通过", () => assert.equal(run(), ""));
test("空集判红", () => assert.match(run({ files: {}, apps: {} }), /0 个/));
test("有 wrangler.toml 未登记判红", () => assert.match(run({ apps: {} }), /未在 .* 登记/));
test("登记了但 app 不存在判红", () => assert.match(run({ apps: { "apps/ops": protectedEntry, "apps/ghost": protectedEntry } }), /ghost.*没有 wrangler/));
test("protected 未依赖共享包判红", () =>
  assert.match(run({ extra: { "apps/ops/package.json": "{}" } }), /dependencies 未声明/));
test("protected 未 import 共享包判红（自己写一份）", () =>
  assert.match(run({ extra: { "apps/ops/src/index.ts": "export const x = 1;\n" } }), /未 import/));
test("protected 未声明 AUD 变量判红（注释掉不算）", () =>
  assert.match(run({ extra: { "apps/ops/wrangler.toml": '[vars]\nACCESS_TEAM_DOMAIN = ""\n# ACCESS_AUD = "<aud>"\n' } }), /未声明 ACCESS_AUD/));
test("protected 没有 behind_access host 判红", () =>
  assert.match(run({ apps: { "apps/ops": { ...protectedEntry, hosts: [] } } }), /behind_access=true/));
test("public 应用却读 Access 头判红", () =>
  assert.match(run({ apps: { "apps/ops": { access: "public", hosts: [] } } , extra: { "apps/ops/src/h.ts": 'req.headers.get("cf-access-jwt-assertion")' } }), /改登记为 protected/));
test("共享包之外自拉证书端点判红", () =>
  assert.match(run({ extra: { "apps/ops/src/access.ts": 'fetch("https://t/cdn-cgi/access/certs")' } }), /证书端点/));
test("共享包之外自己验签判红", () =>
  assert.match(run({ extra: { "packages/p/src/a.ts": 'h.get("Cf-Access-Jwt-Assertion"); await jwtVerify(t, k)' } }), /自己对 Access JWT 验签/));
test("共享包内部不算违规", () =>
  assert.equal(run({ extra: { "packages/coord-access/src/index.ts": 'fetch("https://t/cdn-cgi/access/certs")' } }), ""));
