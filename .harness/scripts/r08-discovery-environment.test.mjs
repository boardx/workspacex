import { test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { r08DiscoveryEnvironment, cnDiscoveryEnvironment, specsMatchedBy } from "./lint-spec-gate-coverage.mjs";

test("R01 and R08 discovery placeholders are available only to explicit Playwright list", () => {
  const result = r08DiscoveryEnvironment(["exec", "playwright", "test", "--list"], {});
  assert.equal(result.BOARD_PEER_WEB_URL, "http://127.0.0.1:39002");
  assert.equal(result.BOARD_PEER_OUTPUT_DIR, "spec-gate-discovery-only");
  assert.equal(result.BOARD_R01_WEB_URL, "http://127.0.0.1:39002");
  assert.equal(result.BOARD_R01_OUTPUT_DIR, "spec-gate-discovery-only");
  assert.equal(result.BOARD_CONNECTOR_RUNTIME_MANIFEST, "spec-gate-discovery-only/no-runtime-manifest.json");
  for (const key of ["BOARD_ACCEPTANCE_SHA", "BOARD_ACCEPTANCE_RUNTIME_MARKER", "BOARD_ACCEPTANCE_RUNTIME_STARTED_AT"])
    assert.equal(result[key], "discovery-not-runtime");
  for (const args of [[], ["exec", "playwright", "test"], ["--list=false"]])
    assert.throws(() => r08DiscoveryEnvironment(args, {}), /require Playwright --list/);
});

test("discovery preserves explicit owner environment without mutating or inventing attestation", () => {
  const environment = { BOARD_R01_WEB_URL: "http://127.0.0.1:36317", BOARD_R01_OUTPUT_DIR: "/owned/r01-output", BOARD_CONNECTOR_RUNTIME_MANIFEST: "/owned/manifest.json", BOARD_PEER_WEB_URL: "http://127.0.0.1:36317", BOARD_PEER_OUTPUT_DIR: "/owned/output", BOARD_ACCEPTANCE_SHA: "owner-source", BOARD_ACCEPTANCE_RUNTIME_MARKER: "owner-marker", BOARD_ACCEPTANCE_RUNTIME_STARTED_AT: "owner-start", CUSTOM: "keep" };
  const before = { ...environment };
  assert.deepEqual(r08DiscoveryEnvironment(["--list"], environment), before);
  assert.deepEqual(environment, before);
  assert.equal(r08DiscoveryEnvironment(["--list"], {}).BOARD_PEER_RUNTIME_MANIFEST, undefined);
  assert.equal(r08DiscoveryEnvironment(["--list"], {}).BOARD_CONNECTOR_RUNTIME_VERIFIER, undefined);
});


test("CN placeholders are isolated to the exact CN config and explicit list", () => {
  const environment = { CN_RELEASE_FULLSTACK_FIXTURE: "owner", CN_SIX_INFRA_RECEIPT: "/owned/real.json", WORKSPACEX_REUSE_INFRA: "owner", CN_SIX_REPORT_PATH: "/owned/report", CN_SIX_OUTPUT_DIR: "/owned/output" };
  const before = { ...environment };
  for (const config of ["apps/web/playwright.r08.config.ts", "apps/web/playwright.config.ts", "other/playwright.cn-six-business.config.ts", "apps/web/playwright.cn-six-business.config.ts.extra"])
    assert.deepEqual(cnDiscoveryEnvironment(["--list"], config, environment), before);
  assert.deepEqual(environment, before);
  const cn = cnDiscoveryEnvironment(["--list"], "apps/web/playwright.cn-six-business.config.ts", environment);
  assert.equal(cn.CN_RELEASE_FULLSTACK_FIXTURE, "1");
  assert.equal(cn.CN_SIX_REPORT_PATH, "");
  assert.equal(cn.CN_SIX_INFRA_RECEIPT, "spec-gate-discovery-only/no-runtime-receipt.json");
  assert.equal(cn.CN_TEST_CHROMIUM, process.execPath);
  assert.deepEqual(environment, before);
  assert.throws(() => cnDiscoveryEnvironment(["--list=false"], "apps/web/playwright.cn-six-business.config.ts", environment), /require Playwright --list/);
});

test("actual CN list imports without a browser while runtime config still rejects missing owner executable", () => {
  const previous = process.env.CN_TEST_CHROMIUM;
  const configPath = "apps/web/playwright.cn-six-business.config.ts";
  try {
    delete process.env.CN_TEST_CHROMIUM;
    assert.deepEqual(specsMatchedBy({ pkgDir: "apps/web", configPath }),
      ["apps/web/e2e/cn-release-six-business.spec.ts"]);
    assert.equal(process.env.CN_TEST_CHROMIUM, undefined);
    // Import only: no Playwright execution or webServer startup in this negative.
    const env = cnDiscoveryEnvironment(["--list"], configPath, process.env);
    delete env.CN_TEST_CHROMIUM;
    for (const [i, name] of ["API", "WEB", "MODEL_PROVIDER", "DEEP_AGENT_PROVIDER", "LOOPBACK_SANDBOX", "ASR_PROVIDER", "VISION_PROVIDER"].entries())
      env["WORKSPACEX_" + name + "_PORT"] = String(39001 + i);
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `await import(${JSON.stringify("./" + configPath)})`],
      { cwd: root, env, encoding: "utf8", timeout: 15000, maxBuffer: 65536 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EXPLICIT_INSTALLED_CHROMIUM_REQUIRED/);
  } finally {
    if (previous === undefined) delete process.env.CN_TEST_CHROMIUM;
    else process.env.CN_TEST_CHROMIUM = previous;
  }
});
