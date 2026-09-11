import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file=resolve(import.meta.dirname,"publish-cn-release.sh");
const source=readFileSync(file,"utf8");

describe("China production release publisher",()=>{
  it("requires a clean exact main revision and digest-pinned dependencies",()=>{
    expect(source).toContain('[[ $# -eq 2 && "$1" =~ ^[a-f0-9]{40}$');
    expect(source).toContain('rev-parse HEAD');
    expect(source).toContain('status --porcelain');
    expect(source).toContain('merge-base --is-ancestor "$revision" origin/main');
    expect(source).toContain("@sha256:[a-f0-9]{64}");
  });
  it("exports the Agent source from the immutable Git object and never copies local secrets",()=>{
    expect(source).toContain('git -C "$REPOSITORY_DIR" archive "$revision" apps/deep-agent-service');
    expect(source).not.toContain("cp -a apps/deep-agent-service");
    expect(source).not.toMatch(/docker login|PASSWORD|SECRET/);
  });
  it("builds, pushes and registry-pulls exactly four application images",()=>{
    expect(source.match(/build_and_push (api|web|agent|sandbox) /g)).toHaveLength(4);
    expect(source).toContain('docker push "$tag"');
    expect(source).toContain('docker pull --platform "$platform" "$tag"');
    expect(source).toContain("existing immutable $service tag has a different revision");
  });
  it("uses the canonical six-image manifest CLI and installs an immutable runner-readable result",()=>{
    for(const service of ["web","api","agent","sandbox","postgres","redis"])expect(source).toContain(`${service}:`);
    expect(source).toContain("release-manifest-cli.ts");
    expect(source).toContain('cmp --silent "$generated" "$manifest"');
    expect(source).toContain('install -o root -g "$runner_group" -m 0640 "$generated" "$manifest"');
    expect(statSync(file).mode&0o111).not.toBe(0);
  });
});
