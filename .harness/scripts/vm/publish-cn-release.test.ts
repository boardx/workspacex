import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file=resolve(import.meta.dirname,"publish-cn-release.sh");
const source=readFileSync(file,"utf8");
const apiDockerfile=readFileSync(resolve(import.meta.dirname,"../../../deploy/aliyun/images/api.Dockerfile"),"utf8");
const webDockerfile=readFileSync(resolve(import.meta.dirname,"../../../deploy/aliyun/images/web.Dockerfile"),"utf8");
const agentDockerfile=readFileSync(resolve(import.meta.dirname,"../../../apps/deep-agent-service/Dockerfile"),"utf8");
const sandboxDockerfile=readFileSync(resolve(import.meta.dirname,"../../../apps/skill-sandbox/Dockerfile"),"utf8");

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
    expect(source).toContain('build_and_push agent deep-agent "$work/agent/Dockerfile" "$work/agent" --build-arg "PYTHON_IMAGE=$python_image" --build-arg "PYPI_INDEX_URL=$pypi_index_url" --build-arg "SOURCE_REVISION=$revision"');
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
  it("requires Buildx and preserves revision verification",()=>{
    expect(source).toContain('docker buildx version >/dev/null 2>&1 || fail "Docker buildx unavailable"');
    expect(source).toContain('docker buildx build --load --platform "$platform" "$@" -f "$dockerfile" -t "$tag" "$context"');
    expect(source).not.toContain("build_engine=");
    expect(source).not.toContain('docker build "$@"');
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
  it("passes validated package indexes only to integrity-locked dependency installs",()=>{
    expect(source).toContain('npm_registry=${WSX_NPM_REGISTRY:-https://registry.npmjs.org}');
    expect(source).toContain('pypi_index_url=${WSX_PYPI_INDEX_URL:-https://pypi.org/simple}');
    expect(source).toContain('apt_mirror=${WSX_APT_MIRROR:-https://deb.debian.org}');
    expect(source).toContain('validate_package_index "$npm_registry" npm');
    expect(source).toContain('validate_package_index "$pypi_index_url" PyPI');
    expect(source).toContain('validate_package_index "$apt_mirror" APT');
    expect(source.match(/--build-arg "NPM_REGISTRY=\$npm_registry"/g)).toHaveLength(3);
    expect(source.match(/--build-arg "PYPI_INDEX_URL=\$pypi_index_url"/g)).toHaveLength(2);
    for(const dockerfile of [apiDockerfile,webDockerfile]){
      expect(dockerfile).toContain('ARG NPM_REGISTRY=https://registry.npmjs.org');
      expect(dockerfile).toContain('npm_config_registry="$NPM_REGISTRY"');
      expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    }
    expect(agentDockerfile).toContain('ARG PYPI_INDEX_URL=https://pypi.org/simple');
    expect(agentDockerfile).toContain('uv export --frozen --no-dev --no-emit-project --format requirements-txt');
    expect(agentDockerfile).toContain('uv pip install --python /app/.venv/bin/python --require-hashes');
    expect(agentDockerfile).toContain('--default-index "$PYPI_INDEX_URL"');
    expect(agentDockerfile).toContain('PYTHONPATH="/app/src"');
    expect(agentDockerfile).not.toContain('uv sync --frozen');
    expect(sandboxDockerfile).toContain('ARG PYPI_INDEX_URL=https://pypi.org/simple');
    expect(sandboxDockerfile).toContain('ARG NPM_REGISTRY=https://registry.npmjs.org');
    expect(sandboxDockerfile).toContain('ARG APT_MIRROR=https://deb.debian.org');
    expect(sandboxDockerfile).toContain('apt-get install -y --no-install-recommends ca-certificates');
    expect(source).toContain('build_and_push sandbox skill-sandbox apps/skill-sandbox/Dockerfile apps/skill-sandbox --build-arg "NODE_IMAGE=$node_image" --build-arg "PYTHON_IMAGE=$python_image" --build-arg "NPM_REGISTRY=$npm_registry" --build-arg "PYPI_INDEX_URL=$pypi_index_url" --build-arg "APT_MIRROR=$apt_mirror"');
    expect(sandboxDockerfile.match(/sed -Ei "s#https\?:\/\/deb\.debian\.org#\$\{APT_MIRROR\}#g"/g)).toHaveLength(4);
    expect(sandboxDockerfile.match(/PIP_INDEX_URL="\$PYPI_INDEX_URL"/g)).toHaveLength(2);
    expect(sandboxDockerfile.match(/--require-hashes/g)).toHaveLength(2);
  });
  it("builds the Sandbox without GitHub Raw and verifies its vendored analysis font",()=>{
    expect(sandboxDockerfile).not.toContain("raw.githubusercontent.com");
    expect(sandboxDockerfile).toContain("COPY analysis/AnalysisSans.ttf /font/AnalysisSans.ttf");
    expect(sandboxDockerfile).toContain("910a3152dfc32dfa63db8d1dc8bac55c526bb9ae4729274dd76d41524894c9fd  /font/AnalysisSans.ttf");
    expect(sandboxDockerfile).toContain("sha256sum --check --strict");
    expect(sandboxDockerfile).toContain("COPY analysis/AnalysisSans.NOTICE /font/NOTICE");
  });
});
