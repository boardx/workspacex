/**
 * 2026-09-22 —— 把 `config.ts` 里那个**字面量** `WORKSPACEX_EDITION: "local"` 钉在契约上。
 *
 * 这个包刻意不依赖 `@repo/contracts`（见 package.json），所以那一行不能 import 契约常量。
 * 于是它就是「同一事实的第二份声明」——本仓头号病。这份测试直接**读契约源码**来核对：
 * 变量名或版次枚举值哪天在契约里改了名，这里当场红，而不是等到本地版悄悄按 cloud 跑。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { apiEnv, webEnv, type LocalConfig } from "../src/config";

const contractSource = readFileSync(
  join(import.meta.dirname, "..", "..", "contracts", "src", "deployment.ts"),
  "utf8",
);

function envName(): string {
  const m = /DEPLOYMENT_EDITION_ENV\s*=\s*"([^"]+)"/.exec(contractSource);
  if (m === null) throw new Error("contract no longer declares DEPLOYMENT_EDITION_ENV as a string literal");
  return m[1]!;
}

function editions(): readonly string[] {
  const m = /DeploymentEdition\s*=\s*z\.enum\(\[([^\]]+)\]\)/.exec(contractSource);
  if (m === null) throw new Error("contract no longer declares DeploymentEdition as a z.enum literal");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

const fakeConfig = {
  repoRoot: "/repo", dataDir: "/data",
  ports: { api: 1, web: 2, postgres: 3, deepAgent: 4, sandbox: 5, ollama: 6, asr: 7 },
  chatModel: "m", metaModel: "m",
  secrets: { adminPassword: "p", deepAgentInternalKey: "k", sessionSecret: "s", emailVerificationSecret: "e" },
} as unknown as LocalConfig;

it("hands the API exactly the edition variable the contract declares", () => {
  const env = apiEnv(fakeConfig) as Record<string, string>;
  const name = envName();
  expect(name).toBe("WORKSPACEX_EDITION");
  expect(env[name]).toBe("local");
  expect(editions()).toContain(env[name]);
});

it("marks the web process as the local edition too", () => {
  // 后端与前端读的是**同一个**变量名；前端少了它就会整屏按在线版渲染，
  // 而它恰好是「界面上看得出本地版」这件事的唯一开关。
  const env = webEnv(fakeConfig, {}) as Record<string, string>;
  expect(env[envName()]).toBe("local");
});

it("passes the online address through only when the host actually set one", () => {
  const cloudEnvName = /DEPLOYMENT_CLOUD_URL_ENV\s*=\s*"([^"]+)"/.exec(contractSource)?.[1];
  expect(cloudEnvName).toBe("WORKSPACEX_CLOUD_URL");
  // 没设 ⇒ 键根本不出现（不是空串：空串会让下游以为「配过但配空了」）
  expect(Object.keys(webEnv(fakeConfig, {}))).not.toContain(cloudEnvName!);
  const passed = webEnv(fakeConfig, { WORKSPACEX_CLOUD_URL: " https://app.example.com " }) as Record<string, string>;
  expect(passed[cloudEnvName!]).toBe("https://app.example.com");
});

it("still hands the API the Ollama placeholder key, which is why the image gate is needed", () => {
  /*
   * 这一条不是要求「必须这么设」，而是把**另一半证据**钉在这里：
   * `apps/api/tests/agent-runtime/local-edition-no-image-egress.test.ts` 的前提是
   * 「本地版 env 里 KERNEL_MODEL_API_KEY 是一个非空占位值、且没有 KERNEL_IMAGE_PROVIDER」。
   * 那个前提一旦在这里被改掉（比如换成空串），那边的反证就会悄悄失去意义。
   */
  const env = apiEnv(fakeConfig) as Record<string, string | undefined>;
  expect(env.KERNEL_MODEL_API_KEY).toBe("ollama-local");
  expect(env.KERNEL_IMAGE_PROVIDER).toBeUndefined();
});
