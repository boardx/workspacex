import { deploymentConfigSchema } from "./config.js";
import { deploymentStorageEnvironment } from "./storage-config.js";
import { validateReleaseManifest } from "./release.js";
import { z } from "zod";

const optionsSchema = z.object({
  projectName: z.string().regex(/^[a-z][a-z0-9_-]{0,40}$/),
  runtimeDirectory: z.string().regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/),
}).strict();
export type CloudComposeOptions = z.infer<typeof optionsSchema>;

/** JSON is accepted natively by Docker Compose. Secret values stay in prepared env/config files. */
export function createCloudCompose(configInput: unknown, releaseInput: unknown, optionsInput: CloudComposeOptions) {
  const config = deploymentConfigSchema.parse(configInput);
  const release = validateReleaseManifest(releaseInput);
  const options = optionsSchema.parse(optionsInput);
  if (config.provision.release !== release.release) throw new Error("RELEASE_VERSION_MISMATCH");
  const dir = options.runtimeDirectory;
  const base = { pull_policy: "never", restart: "unless-stopped", init: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], pids_limit: 256 };
  const bind = (source: string, target: string, readOnly = false) => ({ type: "bind", source, target, read_only: readOnly, bind: { create_host_path: false } });
  const services: Record<string, Record<string, unknown>> = {
    web: { ...base, image: release.images.web.image, platform: release.platform, env_file: [{ path: `${dir}/web.env`, format: "raw" }], ports: ["127.0.0.1:3000:3000"], mem_limit: "2g", cpus: 2 },
    api: { ...base, image: release.images.api.image, platform: release.platform, env_file: [{ path: `${dir}/api.env`, format: "raw" }], ports: ["127.0.0.1:3200:3200"], mem_limit: "2g", cpus: 2,
      environment: { ...deploymentStorageEnvironment(config), PORT: "3200", KERNEL_DEEP_AGENT_BASE_URL: "http://agent:8000", KERNEL_SKILL_SANDBOX_SOCKET: "/run/sandbox/skill-sandbox.sock", NATIVE_SESSION_SOCKET: "/run/sessions/skill-sandbox.sock" },
      volumes: [bind(`${dir}/sandbox`, "/run/sandbox"), bind(`${dir}/sessions`, "/run/sessions"), bind(`${dir}/certs`, "/run/certs", true)] },
    agent: { ...base, image: release.images.agent.image, platform: release.platform, env_file: [{ path: `${dir}/agent.env`, format: "raw" }], expose: ["8000"], mem_limit: "4g", cpus: 2,
      volumes: [bind(`${dir}/sessions`, "/run/sessions")] },
    sandbox: { ...base, image: release.images.sandbox.image, platform: release.platform, network_mode: "none", read_only: true, user: "1000:1000", mem_limit: "1g", memswap_limit: "1g", cpus: 1, pids_limit: 128,
      tmpfs: ["/tmp:rw,noexec,nosuid,size=256m,mode=1777"], environment: { SKILL_SANDBOX_SOCKET: "/run/sandbox/skill-sandbox.sock" }, volumes: [bind(`${dir}/sandbox`, "/run/sandbox")] },
    "sandbox-sessions": { ...base, image: release.images.sandbox.image, platform: release.platform, network_mode: "none", read_only: true, user: "1000:1000", mem_limit: "1g", memswap_limit: "1g", cpus: 1, pids_limit: 128,
      security_opt: ["no-new-privileges:true", `seccomp=${dir}/docker-seccomp.json`, "apparmor=workspacex-native-sessions"],
      tmpfs: ["/tmp:rw,noexec,nosuid,size=256m,mode=1777"], environment: { SKILL_SANDBOX_SESSIONS_ONLY: "1", SKILL_SANDBOX_SOCKET: "/run/sessions/skill-sandbox.sock" }, volumes: [bind(`${dir}/sessions`, "/run/sessions")] },
  };
  if (config.environment.profile === "starter") {
    const data = config.environment.dataVolumePath;
    services.postgres = { image: release.images.postgres.image, platform: release.platform, pull_policy: "never", restart: "unless-stopped", env_file: [{ path: `${dir}/postgres.env`, format: "raw" }], volumes: [bind(`${data}/postgres`, "/var/lib/postgresql/data")], mem_limit: "2g", cpus: 2, pids_limit: 256 };
    services.redis = { image: release.images.redis.image, platform: release.platform, pull_policy: "never", restart: "unless-stopped", command: ["redis-server", "/run/secrets/redis.conf"], volumes: [bind(`${data}/redis`, "/data"), bind(`${dir}/redis.conf`, "/run/secrets/redis.conf", true)], mem_limit: "512m", cpus: 1, pids_limit: 128 };
  }
  return { name: options.projectName, services };
}
