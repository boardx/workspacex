/**
 * real-model-smoke-fixture.ts —— 真实模型 e2e 通道（issue #2802）的**唯一**配置解析处。
 *
 * 两条 lane 共用这一份解析：
 *   · devapp 自建 runner（`.github/workflows/real-model-chat-evidence.yml`）——对着
 *     真实部署跑，凭据来自那台机器上已有的 env 文件；
 *   · 本地 Mac（`pnpm run e2e:real-model-smoke`）——对着 `e2e-up.sh` 起的本地真栈跑，
 *     账号用 fullstack 种子里的那一位。
 * 断言只写一遍（`real-model-pdf-smoke.spec.ts`），跑两次，不分叉成两份 spec。
 *
 * ## 缺凭据时的行为：显式 skip 并点名缺了谁
 *
 * 不允许"无声跳过"，更不允许退回回环模型然后把结果说成真实模型跑通——#2802 的整条
 * issue 就是这件事。`skipReason` 会逐字列出缺的变量名，spec 用它做文件级 skip。
 */
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

/** 人类 2026-09-05 在 devapp 上反复撞红的那一句，逐字。默认值即被测用例本身。 */
export const REAL_MODEL_DEFAULT_PROMPT = "生成一个 pdf，总结你可以做的事情";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

function positiveInt(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 本地 lane 的账号来源：`REAL_MODEL_E2E_USE_FULLSTACK_SEED=1` 时用 fullstack 种子
 * 里的引导师账号（`e2e-up.sh` 刚种出来的那一位）。
 *
 * ⚠ 这是**显式 opt-in**，不是"找不到凭据就自己找一个"的静默兜底：devapp lane 不设
 *   这个开关，缺账号就红，不会误连到一个种子账号上去。证据包 `00-context.json` 的
 *   `credentialSource` 逐次记录这次用的是哪一种。
 */
const useSeedAccount = env("REAL_MODEL_E2E_USE_FULLSTACK_SEED") === "1";

const email = env("REAL_MODEL_E2E_EMAIL") ?? (useSeedAccount ? FULLSTACK_E2E.email : undefined);
const password = env("REAL_MODEL_E2E_PASSWORD") ?? (useSeedAccount ? FULLSTACK_E2E.password : undefined);

const missing: string[] = [];
if (email === undefined) missing.push("REAL_MODEL_E2E_EMAIL");
if (password === undefined) missing.push("REAL_MODEL_E2E_PASSWORD");

export const REAL_MODEL_SMOKE = {
  email: email ?? "",
  password: password ?? "",
  credentialSource: email === undefined
    ? "<none>"
    : env("REAL_MODEL_E2E_EMAIL") !== undefined
      ? "REAL_MODEL_E2E_EMAIL/REAL_MODEL_E2E_PASSWORD"
      : "fullstack-smoke seed account (REAL_MODEL_E2E_USE_FULLSTACK_SEED=1)",
  prompt: env("REAL_MODEL_E2E_PROMPT") ?? REAL_MODEL_DEFAULT_PROMPT,
  /**
   * 断言 ⑥ 判的产物类型。默认是 PDF —— 两条 lane 的既有行为**一个字不变**。
   *
   * 之所以做成可配：平台技能目录里有四个官方 skill（pptx/docx/xlsx/pdf-create，
   * 见 `platform-skill-catalog.ts`），而这条 lane 原来只覆盖其中一个。换个 prompt
   * 加一对期望值就能把另外三个也走一遍真实模型，不必分叉出第二份 spec。
   *
   * `expectMagic` 判的是**文件头字节**，不是扩展名：PDF 是 `%PDF-`；OOXML 三兄弟
   * （docx/xlsx/pptx）都是 zip 容器，用 `PK` 判。控制字节没法干净地穿过环境变量，
   * 所以这里只取 zip 魔数可打印的前两字节——它已经足够把「真的 OOXML」与占位空壳、
   * 错误 JSON、纯文本区分开，何况长度下限（>1000 字节）是另一条独立判据。
   */
  expectExt: env("REAL_MODEL_E2E_EXPECT_EXT") ?? "pdf",
  expectMagic: env("REAL_MODEL_E2E_EXPECT_MAGIC") ?? "%PDF-",
  /**
   * 一次真实模型 run 的等待上限，默认 15 分钟。
   *
   * ⚠ 给得阔绰是有意的：真实模型这条用例本来就要跑数分钟，而"网关 300–400s 天花板"
   *   （#2795）**本身就是被测对象之一**——把等待压到 5 分钟以内，等于把要测的现象
   *   提前判成超时，测了个寂寞。
   */
  runTimeoutMs: positiveInt("REAL_MODEL_E2E_RUN_TIMEOUT_MS", 900_000),
  /** 证据包目录。workflow 收的就是这个目录。 */
  evidenceDir: env("REAL_MODEL_E2E_EVIDENCE_DIR") ?? "test-results/real-model-evidence",
  /** 目标站点。devapp lane 指线上部署，本地 lane 指隔离出来的 web 端口。 */
  baseUrl: env("REAL_MODEL_E2E_BASE_URL")
    ?? (env("WORKSPACEX_WEB_PORT") !== undefined
      ? `http://127.0.0.1:${env("WORKSPACEX_WEB_PORT")}`
      : "http://127.0.0.1:3000"),
  /** 这次跑的是哪条 lane，纯记录用（证据包里要能看出来）。 */
  lane: env("REAL_MODEL_E2E_LANE") ?? "unspecified",
} as const;

/** 有凭据 ⇒ `null`；缺凭据 ⇒ 一句**点名到变量**的原因，spec 拿它做文件级 skip。 */
export const REAL_MODEL_SKIP_REASON: string | null = missing.length === 0
  ? null
  : `真实模型 e2e 未运行：缺少环境变量 ${missing.join(" / ")}。`
    + `本地请填 ${process.env.WORKSPACEX_ENV_FILE ?? "<仓库根>/.env.local"}（模板见 .env.local.example）`
    + `或跑 pnpm run e2e:real-model-smoke（它会用 fullstack 种子账号）；`
    + `devapp 请看 .github/workflows/real-model-chat-evidence.yml 头注。`
    + `⚠ 不会退回回环模型冒充真实模型跑通（issue #2802）。`;
