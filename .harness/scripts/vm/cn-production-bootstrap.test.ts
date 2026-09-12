import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const directory = import.meta.dirname;
const bootstrap = readFileSync(resolve(directory, "bootstrap-cn-production.sh"), "utf8");
const deploy = readFileSync(resolve(directory, "deploy-cn-production.sh"), "utf8");

describe("China production trusted deployment entrypoints", () => {
  it("installs a root-owned wrapper and validates sudoers before activation", () => {
    expect(bootstrap).toContain('install -o root -g root -m 0755 "$source_script" "$TRUSTED_DEPLOY_BIN"');
    expect(bootstrap).toContain("chmod 0600 /etc/workspacex-cn/runner-user");
    expect(bootstrap).toContain('visudo -cf "$sudoers_temp"');
    expect(bootstrap).toContain('install -o root -g root -m 0440 "$sudoers_temp" "$SUDOERS_FILE"');
    expect(bootstrap).not.toMatch(/PRIVATE_KEY|PASSWORD|API_KEY=/);
  });

  it("requires Docker Buildx before installing the deployment entrypoint", () => {
    expect(bootstrap).toContain('docker buildx version >/dev/null 2>&1 || { echo "CN_BOOTSTRAP_BUILDX_REQUIRED" >&2; exit 1; }');
  });

  it("accepts only one full SHA and rejects unpromoted code", () => {
    expect(deploy).toContain('[[ $# -eq 1 && "$1" =~ ^[a-f0-9]{40}$ ]]');
    expect(deploy).toContain('status --porcelain');
    expect(deploy).toContain('rev-parse origin/main-cn');
    expect(deploy).toContain('merge-base --is-ancestor "$revision" origin/main');
    expect(deploy).toContain('git -C "$stage/checkout" checkout --quiet --detach "$revision"');
  });

  it("separates the runner mirror from a root-owned prewarmed release tree", () => {
    expect(deploy).toContain('RELEASE_TREE_ROOT=/var/lib/workspacex-cn/releases');
    expect(deploy).toContain('RUNTIME_ROOT=/var/lib/workspacex-cn/runtime');
    expect(bootstrap).toContain('install -d -o root -g root -m 0700 /var/lib/workspacex-cn');
    expect(deploy).toContain('git clone --quiet --no-local --no-checkout "$REPOSITORY_DIR" "$stage/checkout"');
    expect(deploy).toContain('install --frozen-lockfile --ignore-scripts --package-import-method=copy');
    expect(deploy).toContain('chmod -R go-w "$stage/checkout"');
    expect(deploy).toContain('mv "$stage/checkout" "$release_checkout"');
    expect(deploy).toContain('pnpm --filter @repo/cloud-deploy prepare-host -- "$CONFIG_FILE" "$manifest" "$release_checkout" "$runtime"');
  });

  it("keeps image preparation out of the promotion deploy fast path", () => {
    const prepareBranch = deploy.indexOf('if [[ "$mode" == prepare ]]');
    const deployBranch = deploy.indexOf('[[ "$(git -C "$REPOSITORY_DIR" rev-parse origin/main-cn)" == "$revision" ]]', prepareBranch);
    expect(prepareBranch).toBeGreaterThan(-1);
    expect(deployBranch).toBeGreaterThan(prepareBranch);
    expect(deploy.slice(prepareBranch, deployBranch)).toContain("prepare-host");
    expect(deploy.slice(deployBranch)).not.toContain("prepare-host");
    expect(deploy.slice(deployBranch)).toContain('release is not prewarmed; run --prepare before promotion');
  });

  it("uses root-only inputs and a runtime directory isolated by release SHA", () => {
    expect(deploy).toContain('manifest="$RELEASES_DIR/$revision.json"');
    expect(deploy).toContain('runtime="$RUNTIME_ROOT/$revision"');
    expect(deploy).toContain('release_checkout="$RELEASE_TREE_ROOT/$revision"');
    expect(deploy).toContain("REPOSITORY_DIR=/opt/workspacex-cn/repository");
    expect(deploy).not.toContain("REPOSITORY_DIR=${REPOSITORY_DIR:-");
    expect(deploy).toContain('private_root_file "$RUNNER_ID_FILE"');
    expect(deploy).toContain("private_root_file \"$CONFIG_FILE\"");
    expect(deploy).toContain("runner_readable_manifest \"$manifest\"");
    expect(deploy).toContain("private_root_file \"$AGENT_ENV_FILE\"");
    expect(deploy).toContain('"root:$REPOSITORY_GROUP:640"');
  });

  it("prepares before provision and rolls back an invalid nginx update", () => {
    const prepare = deploy.indexOf("prepare-host");
    const nginx = deploy.indexOf("nginx -t");
    const provision = deploy.indexOf(" provision --");
    expect(prepare).toBeGreaterThan(-1);
    expect(nginx).toBeGreaterThan(prepare);
    expect(provision).toBeGreaterThan(nginx);
    expect(deploy).toContain('mv -f "$nginx_backup" "$NGINX_CONFIG"');
    expect(deploy).toContain("another deployment is active");
  });
});
