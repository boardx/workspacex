/**
 * Everything the local build needs to know, derived from TWO inputs: where the repo/bundle
 * is, and where the user's data lives. Every env var handed to a child process is produced
 * here and nowhere else -- the desktop shell, the CLI and the tests all read this one file,
 * so "what does the API need to boot locally" has a single answer (AGENTS.md: 同一事实不得
 * 声明在两处).
 *
 * The variable NAMES are the ones the services already read today (see
 * `apps/api/src/infrastructure/**`, `apps/deep-agent-service/src/**`); this file adds no
 * new configuration surface to any service. It only fills the existing one in for the
 * single-machine shape.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LocalPorts {
  readonly postgres: number;
  readonly api: number;
  readonly web: number;
  readonly sandbox: number;
  readonly deepAgent: number;
  readonly ollama: number;
  readonly asr: number;
}

export const DEFAULT_PORTS: LocalPorts = {
  postgres: 55432,
  api: 3200,
  web: 3100,
  sandbox: 3310,
  deepAgent: 2024,
  ollama: 11434,
  asr: 3320,
};

/** sherpa-onnx streaming Zipformer, bilingual zh+en (scripts/local-bundle/fetch-asr-model.sh). */
export const DEFAULT_ASR_MODEL = "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20";

/** Ollama tag. Carries tools / vision / thinking; ~2.5-3 GB at Q4_K_M. */
export const DEFAULT_CHAT_MODEL = "qwen3.5:4b";
/** Ollama embedding model used by the deep-agent retrieval endpoints (`/v1/embeddings`). */
export const DEFAULT_EMBEDDING_MODEL = "qwen3-embedding:0.6b";

export const LOCAL_ADMIN_EMAIL = "me@local.workspacex";
export const LOCAL_ADMIN_NAME = "本地用户";
export const LOCAL_ORG_NAME = "我的本地工作区";

/** Database roles as the API's `pg-config.ts` names them (defaults there, repeated here on purpose only as the PGlite open-as username). */
export const DB_OWNER_ROLE = "postgres";
export const DB_APP_ROLE = "app_rw";
export const DB_NAME = "workspacex";

export interface LocalSecrets {
  readonly modelCredentialKey: string;
  readonly emailVerificationSecret: string;
  readonly deepAgentInternalKey: string;
  readonly adminPassword: string;
}

export interface LocalConfig {
  /** Monorepo root (dev) or unpacked bundle root (desktop). Must contain apps/api etc. */
  readonly repoRoot: string;
  /** Per-user writable data dir: database, objects, sessions, models, logs. */
  readonly dataDir: string;
  readonly ports: LocalPorts;
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly secrets: LocalSecrets;
}

export interface ResolveOptions {
  readonly repoRoot: string;
  readonly dataDir: string;
  readonly ports?: Partial<LocalPorts>;
  readonly chatModel?: string;
  readonly embeddingModel?: string;
}

function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Secrets are generated once per data dir and kept in `secrets.json` (0600). Rotating
 * `modelCredentialKey` would make every stored model credential unreadable, which is why
 * the file is read-before-write and never regenerated when present.
 */
export function loadOrCreateSecrets(dataDir: string): LocalSecrets {
  const path = join(dataDir, "secrets.json");
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalSecrets>;
    const missing = (["modelCredentialKey", "emailVerificationSecret", "deepAgentInternalKey", "adminPassword"] as const)
      .filter((k) => typeof parsed[k] !== "string" || parsed[k] === "");
    if (missing.length > 0) throw new Error(`secrets.json at ${path} is missing ${missing.join(", ")}`);
    return parsed as LocalSecrets;
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const secrets: LocalSecrets = {
    modelCredentialKey: randomSecret(),
    emailVerificationSecret: randomSecret(48),
    deepAgentInternalKey: randomSecret(),
    // Human-typeable: the user logs in with this once, then the desktop shell remembers the session.
    adminPassword: randomSecret(12),
  };
  writeFileSync(path, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

export function resolveLocalConfig(opts: ResolveOptions): LocalConfig {
  for (const rel of ["apps/api/package.json", "apps/web/package.json", "apps/skill-sandbox/package.json"]) {
    if (!existsSync(join(opts.repoRoot, rel))) throw new Error(`repoRoot ${opts.repoRoot} lacks ${rel}`);
  }
  return {
    repoRoot: opts.repoRoot,
    dataDir: opts.dataDir,
    ports: { ...DEFAULT_PORTS, ...(opts.ports ?? {}) },
    chatModel: opts.chatModel ?? DEFAULT_CHAT_MODEL,
    embeddingModel: opts.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
    secrets: loadOrCreateSecrets(opts.dataDir),
  };
}

type Env = Record<string, string>;

export const paths = {
  pgData: (c: LocalConfig) => join(c.dataDir, "pgdata"),
  objects: (c: LocalConfig) => join(c.dataDir, "objects"),
  sessions: (c: LocalConfig) => join(c.dataDir, "sessions.json"),
  models: (c: LocalConfig) => join(c.dataDir, "models"),
  logs: (c: LocalConfig) => join(c.dataDir, "logs"),
  sandboxIn: (c: LocalConfig) => join(c.dataDir, "sandbox", "in"),
  sandboxOut: (c: LocalConfig) => join(c.dataDir, "sandbox", "out"),
  seedState: (c: LocalConfig) => join(c.dataDir, "seed-state.json"),
  deepAgentVenv: (c: LocalConfig) => join(c.repoRoot, "apps", "deep-agent-service", ".venv"),
  asrModelDir: (c: LocalConfig) => join(c.dataDir, "asr-models", DEFAULT_ASR_MODEL),
};

/** Only handed to the API when the model is on disk; otherwise ASR stays "not configured". */
export function asrEnv(c: LocalConfig): Env {
  return {
    KERNEL_ASR_PROVIDER: "local-gateway",
    KERNEL_ASR_BASE_URL: `ws://127.0.0.1:${c.ports.asr}`,
    KERNEL_ASR_API_KEY: "local",
    KERNEL_ASR_MODEL: DEFAULT_ASR_MODEL,
  };
}

/**
 * Where the streaming ASR model lives: the data dir (fetch-asr-model.sh) wins, else the copy
 * shipped in the bundle (scripts/local-bundle/bundle-asr-model.sh, human decision 2026-09-17:
 * the ASR model goes into the DMG too). The gateway only reads it, so the bundle copy is used
 * in place -- nothing to import.
 */
export function resolveAsrModelDir(c: LocalConfig, bundleAsrModelsDir?: string): string | null {
  const candidates = [paths.asrModelDir(c), ...(bundleAsrModelsDir ? [join(bundleAsrModelsDir, DEFAULT_ASR_MODEL)] : [])];
  for (const dir of candidates) if (existsSync(join(dir, "tokens.txt"))) return dir;
  return null;
}

export function asrGatewayEnv(c: LocalConfig, modelDir: string = paths.asrModelDir(c)): Env {
  return {
    LOCAL_ASR_HOST: "127.0.0.1",
    LOCAL_ASR_PORT: String(c.ports.asr),
    LOCAL_ASR_ENGINE: "sherpa",
    LOCAL_ASR_MODEL_DIR: modelDir,
  };
}

/** Shared by every Node-side process that touches the database (API + seed scripts). */
export function databaseEnv(c: LocalConfig): Env {
  return {
    PGHOST: "127.0.0.1",
    PGPORT: String(c.ports.postgres),
    PGDATABASE: DB_NAME,
    // pglite-socket ignores login user/password (see PROP §3.2 spike notes); these only
    // need to satisfy `pg-config.ts`'s non-empty checks and keep the defaults honest.
    APP_DB_USER: DB_APP_ROLE,
    APP_DB_PASSWORD: "local",
    MIGRATION_DB_USER: DB_OWNER_ROLE,
    MIGRATION_DB_PASSWORD: "local",
    DIAG_DB_USER: DB_APP_ROLE,
    DIAG_DB_PASSWORD: "local",
    PGSSLMODE: "disable",
  };
}

export function modelEnv(c: LocalConfig): Env {
  const base = `http://127.0.0.1:${c.ports.ollama}`;
  return {
    KERNEL_MODEL_PROVIDER: "ollama",
    KERNEL_MODEL_BASE_URL: `${base}/v1`,
    KERNEL_MODEL_API_KEY: "ollama-local",
    KERNEL_MODEL_ID: c.chatModel,
    KERNEL_DEEP_AGENT_MODEL_ID: c.chatModel,
    KERNEL_DEFAULT_AGENT_MODEL_ID: c.chatModel,
    KERNEL_MODEL_VISION_IDS: c.chatModel,
    // A 4B model with thinking on is several times slower; the API already knows how to
    // send `enable_thinking:false` for ids in this list.
    KERNEL_MODEL_THINKING_DISABLE_IDS: c.chatModel,
    KERNEL_MODEL_BAILIAN_EXTENSIONS: "0",
    KERNEL_EMBEDDING_MODEL_ID: c.embeddingModel,
    KERNEL_EMBEDDING_MODEL_VERSION: "local-1",
    KERNEL_RERANK_MODEL_ID: c.chatModel,
    KERNEL_RERANK_MODEL_VERSION: "local-1",
    // personal-local organizations (F16) probe this native Ollama endpoint; must be loopback.
    LOCAL_RUNTIME_ENDPOINT: base,
  };
}

export function apiEnv(c: LocalConfig): Env {
  return {
    ...databaseEnv(c),
    ...modelEnv(c),
    PORT: String(c.ports.api),
    KERNEL_LISTEN_HOST: "127.0.0.1",
    // the platform catalog is seeded in the owner phase (seeds.ts); the API-side self-heal
    // would only hit RLS as app_rw and print 42501/23503 stacks on every boot
    KERNEL_PLATFORM_SKILL_SELFHEAL: "off",
    NODE_ENV: "development",
    // A local 4B model with skill calls needs well over the cloud default of 5 min per run
    // (three-lenses canvas hit the 300 s deadline on a Mac, 2026-09-17).
    KERNEL_DEEP_AGENT_TIMEOUT_MS: "900000",
    // The API loads <repo>/.env.local in development; a developer's cloud settings there
    // (native-session socket, Bailian keys) would silently override the local shape.
    KERNEL_SKIP_LOCAL_ENV_FILE: "1",
    // Native (bubblewrap) sessions are Linux-only; local runs use the legacy profile with
    // the TCP sandbox. Pinned to empty so nothing inherited can re-enable them.
    NATIVE_SESSION_SOCKET: "",
    NATIVE_SESSION_BINDING_KEY: "",
    KERNEL_NATIVE_RUNTIME: "0",
    KERNEL_QUIET: "0",
    APP_PUBLIC_URL: `http://127.0.0.1:${c.ports.web}`,
    KERNEL_CORS_ORIGINS: webOrigins(c).join(","),
    // no Redis on this machine (issue #3716)
    KERNEL_SESSION_STORE: "file",
    KERNEL_SESSION_STORE_FILE: paths.sessions(c),
    // object store: local filesystem is the API's default backend; only the root is set
    WORKSPACEX_OBJECT_STORE: "fs",
    WORKSPACEX_OBJECT_ROOT: paths.objects(c),
    MODEL_CREDENTIAL_KEY: c.secrets.modelCredentialKey,
    EMAIL_VERIFICATION_SECRET: c.secrets.emailVerificationSecret,
    PLATFORM_SUPERUSER_EMAILS: LOCAL_ADMIN_EMAIL,
    // skill sandbox: TCP loopback child process (L0 isolation, see PROP §3.5)
    KERNEL_SKILL_SANDBOX_BASE_URL: `http://127.0.0.1:${c.ports.sandbox}`,
    SKILL_SANDBOX_INPUT_DIR: paths.sandboxIn(c),
    SKILL_SANDBOX_OUT_DIR: paths.sandboxOut(c),
    // deep agent (tool loop lives there)
    KERNEL_DEEP_AGENT_BASE_URL: `http://127.0.0.1:${c.ports.deepAgent}`,
    KERNEL_SUBTASK_CALLBACK_BASE_URL: `http://127.0.0.1:${c.ports.api}`,
    DEEP_AGENT_SERVICE_INTERNAL_KEY: c.secrets.deepAgentInternalKey,
    // capabilities that are vendor-shaped and unavailable offline stay UNSET on purpose:
    // KERNEL_IMAGE_PROVIDER, KERNEL_GUIDED_SEARCH_URL, WORKSPACEX_BROWSER_MCP_ENDPOINT.
    // ASR is the exception: `asrEnv()` is merged in by `up` when the local model is present.
  };
}

/** Flat, real module tree for skill scripts (scripts/local-bundle/prepare-sandbox-modules.sh); null when not prepared. */
export function sandboxModulesDir(c: LocalConfig): string | null {
  const dir = join(c.repoRoot, "apps", "skill-sandbox", "preinstalled", "node_modules");
  return existsSync(join(dir, "pptxgenjs")) ? dir : null;
}

export function sandboxEnv(c: LocalConfig): Env {
  const modules = sandboxModulesDir(c);
  return {
    SKILL_SANDBOX_HOST: "127.0.0.1",
    SKILL_SANDBOX_PORT: String(c.ports.sandbox),
    SKILL_SANDBOX_INPUT_DIR: paths.sandboxIn(c),
    SKILL_SANDBOX_OUT_DIR: paths.sandboxOut(c),
    // Without this every require('pptxgenjs') inside a skill script is MODULE_NOT_FOUND
    // (the sandbox runs scripts in a tmp dir, not in the workspace). See the header of
    // scripts/local-bundle/prepare-sandbox-modules.sh.
    ...(modules ? { SKILL_SANDBOX_MODULES_DIR: modules } : {}),
  };
}

export function deepAgentEnv(c: LocalConfig): Env {
  const uri = `postgresql://${DB_APP_ROLE}:local@127.0.0.1:${c.ports.postgres}/${DB_NAME}`;
  return {
    ...modelEnv(c),
    DATABASE_URI: uri,
    DEEP_AGENT_CHECKPOINT_DB: uri,
    // single-session backend: a connect can legitimately queue behind a busy neighbour
    DEEP_AGENT_PG_CONNECT_TIMEOUT_SECONDS: "30",
    DEEP_AGENT_PG_CONNECT_RETRIES: "2",
    DEEP_AGENT_SERVICE_INTERNAL_KEY: c.secrets.deepAgentInternalKey,
    DEEP_AGENT_OTEL_DISABLED: "1",
    PYTHONPATH: join(c.repoRoot, "apps", "deep-agent-service", "src"),
  };
}

/**
 * The browser calls the API directly on its own port. The API has no CORS layer in
 * production (Caddy makes it same-origin there); for the local build the API enables CORS
 * for exactly the origins the web app is served on (`KERNEL_CORS_ORIGINS`, see apiEnv), so
 * both `localhost` and `127.0.0.1` tabs work. Bearer tokens, no cookies.
 */
export function webEnv(c: LocalConfig): Env {
  const api = `http://127.0.0.1:${c.ports.api}`;
  return {
    PORT: String(c.ports.web),
    NEXT_PUBLIC_API_URL: api,
    NEXT_PUBLIC_API_WS_URL: api,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

/** Origins the web app may be opened on; the API's CORS allowlist is exactly this. */
export function webOrigins(c: LocalConfig): string[] {
  return [`http://127.0.0.1:${c.ports.web}`, `http://localhost:${c.ports.web}`];
}

export function ollamaEnv(c: LocalConfig): Env {
  return {
    OLLAMA_HOST: `127.0.0.1:${c.ports.ollama}`,
    OLLAMA_MODELS: paths.models(c),
  };
}

export function provisionAdminEnv(c: LocalConfig): Env {
  return {
    PROVISION_ADMIN_EMAIL: LOCAL_ADMIN_EMAIL,
    PROVISION_ADMIN_PASSWORD: c.secrets.adminPassword,
    PROVISION_ADMIN_NAME: LOCAL_ADMIN_NAME,
    PROVISION_ORG_NAME: LOCAL_ORG_NAME,
  };
}
