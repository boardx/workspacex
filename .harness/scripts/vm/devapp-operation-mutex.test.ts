import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { assertDevappOperationMutex } from "../lib/devapp-operation-mutex";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const policy = JSON.parse(read(".harness/devapp-operation-policy.json"));
const backend = read(".github/workflows/backend-gates.yml");
const installer = read(".github/workflows/devapp-install-trusted-scripts.yml");

describe("Devapp privileged operation mutex (#5040)", () => {
  it("shares the authoritative target group across the existing two entry points", () => {
    expect(() => assertDevappOperationMutex(policy, backend, installer)).not.toThrow();
  });
  it("rejects the observed original installer/deploy split", () => {
    const original = parse(installer);
    original.concurrency.group = "workspacex-install-trusted-scripts";
    expect(() => assertDevappOperationMutex(policy, backend, stringify(original))).toThrow("GROUP_DRIFT");
  });
  for (const target of ["deploy", "installer"] as const) {
    for (const mutation of ["different-group", "per-ref", "cancel-true", "cancel-expression", "missing-cancel", "missing-group", "different-queue"] as const) {
      it(`rejects ${target} ${mutation} rather than allowing concurrent or cancelled writes`, () => {
        const b = parse(backend); const i = parse(installer);
        const c = target === "deploy" ? b.jobs.deploy.concurrency : i.concurrency;
        if (mutation === "different-group") c.group = "another-devapp-group";
        if (mutation === "per-ref") c.group = "${{ github.ref }}";
        if (mutation === "cancel-true") c["cancel-in-progress"] = true;
        if (mutation === "cancel-expression") c["cancel-in-progress"] = "${{ true }}";
        if (mutation === "missing-cancel") delete c["cancel-in-progress"];
        if (mutation === "missing-group") delete c.group;
        if (mutation === "different-queue") c.queue = "max";
        expect(() => assertDevappOperationMutex(policy, stringify(b), stringify(i))).toThrow();
      });
    }
  }
  it("rejects an installer job override that bypasses workflow serialization", () => {
    const i = parse(installer); i.jobs.install.concurrency = { group: "bypass", "cancel-in-progress": false };
    expect(() => assertDevappOperationMutex(policy, backend, stringify(i))).toThrow("OVERRIDE");
  });
  it("rejects duplicate YAML keys, missing entry points and dynamic policy groups", () => {
    expect(() => assertDevappOperationMutex(policy, backend, installer + "\nconcurrency: other\n")).toThrow("YAML_INVALID");
    const b = parse(backend); delete b.jobs.deploy;
    expect(() => assertDevappOperationMutex(policy, stringify(b), installer)).toThrow("DEPLOY_JOB");
    expect(() => assertDevappOperationMutex({ ...policy, group: "${{ github.sha }}" }, backend, installer)).toThrow("POLICY_INVALID");
  });
});
