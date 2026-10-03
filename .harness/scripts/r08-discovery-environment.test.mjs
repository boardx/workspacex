import { test } from "vitest";
import assert from "node:assert/strict";
import { r08DiscoveryEnvironment } from "./lint-spec-gate-coverage.mjs";

test("R08 discovery placeholders are available only to explicit Playwright list", () => {
  const result = r08DiscoveryEnvironment(["exec", "playwright", "test", "--list"], {});
  assert.equal(result.BOARD_PEER_WEB_URL, "http://127.0.0.1:39002");
  assert.equal(result.BOARD_PEER_OUTPUT_DIR, "spec-gate-discovery-only");
  for (const key of ["BOARD_ACCEPTANCE_SHA", "BOARD_ACCEPTANCE_RUNTIME_MARKER", "BOARD_ACCEPTANCE_RUNTIME_STARTED_AT"])
    assert.equal(result[key], "discovery-not-runtime");
  for (const args of [[], ["exec", "playwright", "test"], ["--list=false"]])
    assert.throws(() => r08DiscoveryEnvironment(args, {}), /require Playwright --list/);
});

test("discovery preserves explicit owner environment without mutating or inventing attestation", () => {
  const environment = { BOARD_PEER_WEB_URL: "http://127.0.0.1:36317", BOARD_PEER_OUTPUT_DIR: "/owned/output", BOARD_ACCEPTANCE_SHA: "owner-source", BOARD_ACCEPTANCE_RUNTIME_MARKER: "owner-marker", BOARD_ACCEPTANCE_RUNTIME_STARTED_AT: "owner-start", CUSTOM: "keep" };
  const before = { ...environment };
  assert.deepEqual(r08DiscoveryEnvironment(["--list"], environment), before);
  assert.deepEqual(environment, before);
  assert.equal(r08DiscoveryEnvironment(["--list"], {}).BOARD_PEER_RUNTIME_MANIFEST, undefined);
});
