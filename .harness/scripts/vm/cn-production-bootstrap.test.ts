import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const directory = import.meta.dirname;
const bootstrap = readFileSync(resolve(directory, "bootstrap-cn-production.sh"), "utf8");
const deploy = readFileSync(resolve(directory, "deploy-cn-production.sh"), "utf8");
const candidate = readFileSync(resolve(directory, "build-cn-release-candidate.sh"), "utf8");
const browserSmoke = readFileSync(resolve(directory, "cn-release-browser-smoke.mjs"), "utf8");

describe("China production trusted deployment entrypoints", () => {
  it("installs a root-owned wrapper and validates sudoers before activation", () => {
    expect(bootstrap).toContain('install -o root -g root -m 0755 "$source_script" "$TRUSTED_DEPLOY_BIN"');
    expect(bootstrap).toContain("chmod 0600 /etc/workspacex-cn/runner-user");
    expect(bootstrap).toContain('visudo -cf "$sudoers_temp"');
    expect(bootstrap).toContain('install -o root -g root -m 0440 "$sudoers_temp" "$SUDOERS_FILE"');
    expect(bootstrap).not.toMatch(/PRIVATE_KEY|PASSWORD|API_KEY=/);
    expect(bootstrap).toContain("workspacex-cn-build-candidate");
  });

  it("uses one release lock for candidate publication and production activation", () => {
    expect(candidate).toContain("release.lock");
    expect(deploy).toContain("release.lock");
    expect(candidate).toContain("EcsRamRole");
    expect(candidate).toContain('aliyun cr GetAuthorizationToken --region "$region" --InstanceId "$instance_id" --mode EcsRamRole --ram-role-name "$role_name"');
    expect(candidate).not.toContain("--output json");
    expect(candidate).not.toContain("aliyun configure set");
    expect(candidate).not.toContain("--ecs-role-name");
    expect(candidate).toContain("DOCKER_CONFIG");
    expect(candidate).toContain("docker logout");
    expect(candidate).toContain('WSX_ACR_INSTANCE_ID');
    expect(candidate).toContain('--InstanceId "$instance_id"');
    expect(candidate).toContain("candidate_sealed");
    expect(candidate.indexOf('baseline_head=$(git -C "$REPOSITORY_DIR" rev-parse HEAD)')).toBeLessThan(candidate.indexOf('checkout --quiet --detach "$revision"'));
    expect(candidate).toContain('baseline_ref=$(git -C "$REPOSITORY_DIR" symbolic-ref -q HEAD || true)');
    expect(candidate).toContain('restore_checkout || fail "baseline checkout restoration failed"');
    expect(candidate).toContain("CN_CANDIDATE_BASELINE_RESTORE_FAILED");
    expect(deploy).toContain("production_available");
    expect(deploy).toContain("release-events");
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
    expect(deploy).toContain('SOURCE_CACHE=/var/lib/workspacex-cn/source-cache.git');
    expect(deploy).toContain('trusted offline source cache is unavailable');
    expect(deploy).toContain('offline source cache revision mismatch');
    expect(deploy).toContain('offline source cache is partial');
    expect(deploy).toContain('GIT_NO_LAZY_FETCH=1 git -C "$SOURCE_CACHE" fsck --full --no-reflogs');
    expect(deploy).toContain('GIT_NO_LAZY_FETCH=1 git clone --quiet --no-local --single-branch --branch main --no-checkout "$SOURCE_CACHE" "$stage/checkout"');
    expect(deploy).not.toContain('git clone --quiet --no-local --no-checkout "$REPOSITORY_DIR"');
    expect(deploy).toContain('install --frozen-lockfile --ignore-scripts --package-import-method=copy');
    expect(deploy).toContain('chmod -R go-w "$stage/checkout"');
    expect(deploy).toContain('mv "$stage/checkout" "$release_checkout"');
    expect(deploy).toContain('pnpm --filter @repo/cloud-deploy prepare-host "$CONFIG_FILE" "$manifest" "$release_checkout" "$runtime"');
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

  it("proves the browser runtime during prepare and authenticates the notifications contract with the stored bearer", () => {
    const prepareBranch = deploy.indexOf('if [[ "$mode" == prepare ]]');
    const deployBranch = deploy.indexOf('[[ "$(git -C "$REPOSITORY_DIR" rev-parse origin/main-cn)" == "$revision" ]]', prepareBranch);
    const prepareOnly = deploy.slice(prepareBranch, deployBranch);
    expect(prepareOnly).toContain("cn-release-browser-smoke.mjs --preflight");
    expect(deploy).toContain("for candidate in chromium-browser chromium google-chrome");
    expect(deploy.match(/CN_BROWSER_EXECUTABLE_PATH="\$browser_executable"/g)).toHaveLength(2);
    expect(browserSmoke).toContain('createRequire(new URL("../../../apps/api/package.json", import.meta.url))');
    expect(browserSmoke).toContain('requireFromApi("playwright")');
    expect(browserSmoke).toContain("isAbsolute(executablePath)");
    expect(browserSmoke).toContain("access(executablePath, fsConstants.X_OK)");
    expect(browserSmoke).toContain('process.getuid?.() === 0 ? ["--no-sandbox"] : []');
    expect(browserSmoke.match(/chromium\.launch\(await browserLaunchOptions\(\)\)/g)).toHaveLength(2);
    expect(browserSmoke).toContain('window.localStorage.getItem(tokenKey)');
    expect(browserSmoke).toContain('Authorization: `Bearer ${token}`');
    expect(browserSmoke).toContain("Array.isArray(payload?.notifications)");
    expect(browserSmoke).toContain("Number.isInteger(payload?.unreadCount) && payload.unreadCount >= 0");
    expect(browserSmoke).not.toContain('fetch("/api/notifications", { credentials: "include" })');
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
    const nginx = deploy.indexOf("nginx -t", deploy.indexOf('nginx_source="$runtime/nginx.conf"'));
    const provision = deploy.indexOf(" provision \"$request\"");
    expect(prepare).toBeGreaterThan(-1);
    expect(nginx).toBeGreaterThan(prepare);
    expect(provision).toBeGreaterThan(nginx);
    expect(deploy).toContain('mv -f "$nginx_backup" "$NGINX_CONFIG"');
    expect(deploy).toContain("another deployment is active");
  });

  it("binds preparation to the live baseline and drains runs before activation", () => {
    const baseline = deploy.indexOf('capture_baseline "$current_baseline"');
    const drain = deploy.indexOf("wait_for_run_drain", baseline);
    const provision = deploy.indexOf(" provision \"$request\"", drain);
    expect(baseline).toBeGreaterThan(-1);
    expect(deploy).toContain('cn-fast-safe-release validate "$fast_safe_receipt" "$revision" "$baseline_sha" "$manifest"');
    expect(drain).toBeGreaterThan(baseline);
    expect(provision).toBeGreaterThan(drain);
    expect(deploy).toContain("writeback_pending");
    expect(deploy).toContain("activation_deadline=$((SECONDS+300))");
  });

  it("checks stable production identity before any traffic drain or provision", () => {
    const preparePreflight = deploy.indexOf('verify_stable_identity "$baseline_state"');
    const bind = deploy.indexOf('cn-fast-safe-release bind');
    const preflight = deploy.indexOf('verify_stable_identity "$current_baseline"');
    const activation = deploy.indexOf("activation_started=1");
    const drain = deploy.indexOf("enable_run_drain", activation);
    expect(preparePreflight).toBeGreaterThan(-1);
    expect(preparePreflight).toBeLessThan(bind);
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(activation);
    expect(drain).toBeGreaterThan(activation);
    expect(deploy).toContain("stable-secret-preflight \"$baseline_secret_directory\"");
    expect(deploy).toContain("STABLE_SECRET_DIRECTORY=/var/lib/workspacex-cn/stable-secrets");
    expect(deploy.match(/\/var\/lib\/workspacex-cn\/stable-secrets/g)).toHaveLength(1);
    expect(deploy).toContain('[[ "$baseline_secret_directory" == "$STABLE_SECRET_DIRECTORY" ]]');
    expect(deploy).toContain('legacy_flag=(--legacy-baseline)');
    expect(deploy).toContain('"$STABLE_SECRET_DIRECTORY" "${legacy_flag[@]}"');
  });

  it("restores the exact image and ingress baseline on every activation failure", () => {
    expect(deploy).toContain("trap activation_failure EXIT");
    expect(deploy).toContain('docker compose -p "$PROJECT_NAME" -f "$compose_file" -f "$override" up -d --remove-orphans');
    expect(deploy).toContain('install -o root -g root -m 0600 "$baseline_nginx" "$NGINX_CONFIG"');
    expect(deploy).toContain("CN_DEPLOY_ROLLBACK_UNPROVEN");
    expect(deploy).toContain("cn-release-browser-smoke.mjs");
  });
});
