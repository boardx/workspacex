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
    expect(source).toContain('git -C "$REPOSITORY_DIR" archive "$revision" apps/deep-agent-service | tar -x -C "$work/agent" --strip-components=2');
    expect(source).not.toContain('mv "$work/apps/deep-agent-service"/*');
    expect(source).not.toContain('rmdir "$work/apps/deep-agent-service"');
    expect(source).toContain('build_and_push agent deep-agent "$work/agent/Dockerfile" "$work/agent" --build-arg "PYTHON_IMAGE=$python_image" --build-arg "SOURCE_REVISION=$revision"');
    expect(source).not.toContain("cp -a apps/deep-agent-service");
    expect(source).not.toMatch(/WSX_AGENT_BASE|langchain\/langgraph-(api|server)|LANGGRAPH_CLOUD_LICENSE_KEY/);
    expect(source).not.toMatch(/docker login|PASSWORD|SECRET/);
  });
  it("builds, pushes and registry-pulls exactly four application images",()=>{
    expect(source.match(/build_and_push (api|web|agent|sandbox) /g)).toHaveLength(4);
    expect(source).toContain("local service=$1 repository=$2");
    expect(source).toContain("local tag=\"$prefix/$repository:$revision\"");
    expect(source).toContain("build_and_push agent deep-agent ");
    expect(source).toContain("build_and_push sandbox skill-sandbox ");
    expect(source).not.toContain("build_and_push agent agent ");
    expect(source).not.toContain("build_and_push sandbox sandbox ");
    expect(source).toContain('docker push "$tag"');
    expect(source).toContain('docker pull --platform "$platform" "$tag"');
    expect(source).toContain("existing immutable $service tag has a different revision");
  });
  it("falls back to native docker build only for linux/amd64 while preserving revision verification",()=>{
    expect(source).toContain("if docker buildx version >/dev/null 2>&1; then");
    expect(source).toContain('[[ "$platform" == "linux/amd64" ]] || fail "Docker buildx unavailable for non-amd64 platform"');
    expect(source).toContain('[[ "$docker_platform" == "$platform" ]] || fail "Docker buildx unavailable and daemon platform differs"');
    expect(source).toContain('docker build "$@" -f "$dockerfile" -t "$tag" "$context"');
    expect(source).not.toContain("docker buildx imagetools inspect");
    expect(source).toContain('docker image inspect --format \'{{index .Config.Labels "org.opencontainers.image.revision"}}\' "$tag"');
    expect(source).toContain('[[ "$published_revision" == "$revision" ]] || fail "published $service image has a different revision"');
  });
  it("uses the canonical six-image manifest CLI and installs an immutable runner-readable result",()=>{
    for(const service of ["web","api","agent","sandbox","postgres","redis"])expect(source).toContain(`${service}:`);
    expect(source).toContain('agent:entry("deep-agent")');
    expect(source).toContain('sandbox:entry("skill-sandbox")');
    expect(source).not.toContain('agent:entry("agent")');
    expect(source).not.toContain('sandbox:entry("sandbox")');
    expect(source).toContain("release-manifest-cli.ts");
    expect(source).toContain('cmp --silent "$generated" "$manifest"');
    expect(source).toContain('install -o root -g "$runner_group" -m 0640 "$generated" "$manifest"');
    expect(statSync(file).mode&0o111).not.toBe(0);
  });
});
