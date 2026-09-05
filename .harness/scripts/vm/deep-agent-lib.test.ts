import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

// PR #941 审查要求的聚焦覆盖：deploy.sh 第 4h 步（deep-agent-service）的核心可测逻辑。
// 逻辑抽在 deep-agent-lib.sh（sourceable），此处用假 curl/docker 在 PATH 上逐条验证。

const LIB = resolve(import.meta.dirname, "deep-agent-lib.sh");
const DEPLOY = resolve(import.meta.dirname, "deploy.sh");
const PROVISION = resolve(import.meta.dirname, "provision.sh");
const PROJECT_MD = resolve(import.meta.dirname, "../../instructions/project/PROJECT.md");
const temps: string[] = [];

afterEach(() => {
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true });
});

function tempDir(): string {
  const temp = mkdtempSync(join(tmpdir(), "deep-agent-lib-"));
  temps.push(temp);
  return temp;
}

/** 在 `set -euo pipefail` 下 source lib 并跑一段脚本——与 deploy.sh 的真实执行环境一致。 */
function runLib(script: string, env: Record<string, string> = {}, pathPrefix?: string) {
  const path = pathPrefix ? `${pathPrefix}:${process.env.PATH}` : process.env.PATH!;
  const result = spawnSync(
    "bash",
    ["-c", `set -euo pipefail\nsource '${LIB}'\n${script}`],
    { encoding: "utf8", env: { ...process.env, ...env, PATH: path } },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("deep-agent-lib syntax", () => {
  it("bash -n passes for lib, deploy.sh, provision.sh", () => {
    for (const file of [LIB, DEPLOY, PROVISION]) {
      const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
      expect(result.status, `${file}: ${result.stderr}`).toBe(0);
    }
  });
});

describe("read_env_value — pipefail-safe env parsing", () => {
  it("reads a present key (last occurrence wins, value may contain '=')", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(envFile, "A=first\nKERNEL_MODEL_BASE_URL=https://x/v1?a=b\nA=second\n");
    const result = runLib(
      `printf '[%s][%s]' "$(read_env_value '${envFile}' A)" "$(read_env_value '${envFile}' KERNEL_MODEL_BASE_URL)"`,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("[second][https://x/v1?a=b]");
  });

  it("missing key yields empty string WITHOUT killing a `set -euo pipefail` script", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(envFile, "OTHER=1\n");
    // 审查 P1-1 指出的坑：grep|tail|cut 直读在 key 缺失时会静默退出、走不到诊断。
    // 这里断言 read_env_value 之后脚本还活着并能打出后续诊断行。
    const result = runLib(
      `v=$(read_env_value '${envFile}' KERNEL_DEEP_AGENT_MODEL_ID)\necho "still-alive:[$v]"`,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("still-alive:[]");
  });
});

describe("deep_agent_assert_model_env — mandatory model env, no fallback", () => {
  const call = (envFile: string) =>
    `b=$(read_env_value '${envFile}' KERNEL_MODEL_BASE_URL)
k=$(read_env_value '${envFile}' KERNEL_MODEL_API_KEY)
m=$(read_env_value '${envFile}' KERNEL_DEEP_AGENT_MODEL_ID)
deep_agent_assert_model_env '${envFile}' "$b" "$k" "$m"
echo "MODEL_ID=$m"`;

  it("red-fails listing every missing key with the file to fix", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(envFile, "KERNEL_MODEL_BASE_URL=https://x/v1\n");
    const result = runLib(call(envFile));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("KERNEL_MODEL_API_KEY");
    expect(result.stderr).toContain("KERNEL_DEEP_AGENT_MODEL_ID");
    expect(result.stderr).not.toContain("KERNEL_MODEL_BASE_URL=\n"); // present key not listed as missing
    expect(result.stderr).toContain(envFile);
    expect(result.stderr).toContain("每环境必填");
  });

  it("red-fails when KERNEL_DEEP_AGENT_MODEL_ID is present but empty (provision template state)", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(
      envFile,
      "KERNEL_MODEL_BASE_URL=https://x/v1\nKERNEL_MODEL_API_KEY=sk-1\nKERNEL_DEEP_AGENT_MODEL_ID=\n",
    );
    const result = runLib(call(envFile));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("KERNEL_DEEP_AGENT_MODEL_ID");
  });

  it("passes and never substitutes a fallback model id when all three are set", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(
      envFile,
      "KERNEL_MODEL_BASE_URL=https://x/v1\nKERNEL_MODEL_API_KEY=sk-1\nKERNEL_DEEP_AGENT_MODEL_ID=my-model\n",
    );
    const result = runLib(call(envFile));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("MODEL_ID=my-model");
  });

  it("the hard-coded qwen3.8-max fallback is gone from deploy.sh", () => {
    expect(readFileSync(DEPLOY, "utf8")).not.toContain("qwen3.8-max");
  });

  it("provision.sh scaffolds the mandatory KERNEL_DEEP_AGENT_MODEL_ID key", () => {
    expect(readFileSync(PROVISION, "utf8")).toContain("KERNEL_DEEP_AGENT_MODEL_ID=");
  });
});

describe("deep_agent_resolve_host_port — port and BASE_URL are mechanically one fact", () => {
  it("derives BASE_URL from the port when deploy.env has none, and writes it", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(envFile, "OTHER=1\n");
    const result = runLib(`port=$(deep_agent_resolve_host_port '${envFile}' 2025 '')\necho "port=$port"`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("port=2025");
    expect(readFileSync(envFile, "utf8")).toContain("KERNEL_DEEP_AGENT_BASE_URL=http://127.0.0.1:2025");
  });

  it("derives the port from an existing BASE_URL (deploy.env is the single source)", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(envFile, "KERNEL_DEEP_AGENT_BASE_URL=http://127.0.0.1:2031\n");
    const result = runLib(`port=$(deep_agent_resolve_host_port '${envFile}' 2025 '')\necho "port=$port"`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("port=2031");
  });

  it("an override honored only when deploy.env has no BASE_URL yet", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(envFile, "OTHER=1\n");
    const result = runLib(`port=$(deep_agent_resolve_host_port '${envFile}' 2025 2040)\necho "port=$port"`);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("port=2040");
    expect(readFileSync(envFile, "utf8")).toContain("KERNEL_DEEP_AGENT_BASE_URL=http://127.0.0.1:2040");
  });

  it("red-fails on a conflicting override instead of letting container and API drift apart", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(envFile, "KERNEL_DEEP_AGENT_BASE_URL=http://127.0.0.1:2025\n");
    const result = runLib(`deep_agent_resolve_host_port '${envFile}' 2025 2040`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("冲突");
    expect(result.stderr).toContain("PROJECT.md");
  });

  it("red-fails on an unparseable BASE_URL", () => {
    const temp = tempDir();
    const envFile = join(temp, "deploy.env");
    writeFileSync(envFile, "KERNEL_DEEP_AGENT_BASE_URL=not-a-url\n");
    const result = runLib(`deep_agent_resolve_host_port '${envFile}' 2025 ''`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("解析不出端口");
  });

  it("base_url_for_port is the one derivation both directions round-trip through", () => {
    const result = runLib(
      `u=$(deep_agent_base_url_for_port 2025)\np=$(deep_agent_port_from_base_url "$u")\necho "$u -> $p"`,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("http://127.0.0.1:2025 -> 2025");
  });

  it("PROJECT.md registers ports 2024/2025 as the single source of truth", () => {
    const project = readFileSync(PROJECT_MD, "utf8");
    expect(project).toContain("本机端口分配");
    expect(project).toContain("2024");
    expect(project).toContain("2025");
    expect(project).toContain("KERNEL_DEEP_AGENT_BASE_URL");
  });
});

describe("deep_agent_wait_graph_ready — bounded graph readiness, not just /ok", () => {
  function fakeCurl(temp: string, responses: string[]) {
    const seq = join(temp, "curl-sequence");
    const count = join(temp, "curl-count");
    writeFileSync(seq, `${responses.join("\n")}\n`);
    writeFileSync(count, "0\n");
    const curl = join(temp, "curl");
    writeFileSync(
      curl,
      `#!/bin/sh
count=$(cat "${count}")
count=$((count + 1))
printf '%s\\n' "$count" > "${count}"
mode=$(sed -n "\${count}p" "${seq}")
[ -n "$mode" ] || mode=refuse
case "$mode" in
  refuse) exit 7 ;;
  empty) printf '[]' ;;
  other) printf '[{"assistant_id":"x","graph_id":"other-graph"}]' ;;
  ready) printf '[{"assistant_id":"x","graph_id":"Deep Agent","name":"Deep Agent"}]' ;;
esac
`,
    );
    chmodSync(curl, 0o755);
    return count;
  }

  it("succeeds once the target graph_id appears, after connection refusals and wrong graphs", () => {
    const temp = tempDir();
    const count = fakeCurl(temp, ["refuse", "empty", "other", "ready"]);
    const result = runLib(
      `deep_agent_wait_graph_ready http://127.0.0.1:2025 'Deep Agent' 10 0 && echo graph-ready`,
      {},
      temp,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("graph-ready");
    expect(readFileSync(count, "utf8").trim()).toBe("4");
  });

  it("fails bounded when the graph never loads even though the HTTP endpoint answers", () => {
    const temp = tempDir();
    // /ok 之外的教训（#940）：端点应答 ≠ graph 加载成功。所有应答都不含目标 graph。
    const count = fakeCurl(temp, ["other", "other", "other", "other", "other"]);
    const result = runLib(
      `if deep_agent_wait_graph_ready http://127.0.0.1:2025 'Deep Agent' 3 0; then echo unexpected; else echo graph-missing; fi`,
      {},
      temp,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("graph-missing");
    expect(result.stdout).not.toContain("unexpected");
    expect(readFileSync(count, "utf8").trim()).toBe("3"); // bounded: exactly `attempts` probes
  });

  it("deploy.sh asserts graph readiness with container-log diagnostics before declaring ready", () => {
    const deploy = readFileSync(DEPLOY, "utf8");
    expect(deploy).toContain("deep_agent_wait_graph_ready");
    expect(deploy).toMatch(/deep_agent_wait_graph_ready[\s\S]{0,400}docker logs/);
  });
});

describe("deep_agent_gc_images — best-effort repository-local GC", () => {
  function fakeDocker(temp: string, tags: string[], failTag?: string) {
    const log = join(temp, "docker-log");
    const tagsFile = join(temp, "docker-tags");
    writeFileSync(log, "");
    writeFileSync(tagsFile, `${tags.join("\n")}\n`);
    const docker = join(temp, "docker");
    writeFileSync(
      docker,
      `#!/bin/sh
echo "$@" >> "${log}"
case "$1" in
  images) cat "${tagsFile}" ;;
  rmi) [ "$2" = "deep-agent-service:${failTag ?? "__none__"}" ] && exit 1 || exit 0 ;;
esac
`,
    );
    chmodSync(docker, 0o755);
    return log;
  }

  it("removes stale tags (incl. manual latest/test-fix) while keeping current SHA and previous tag", () => {
    const temp = tempDir();
    const log = fakeDocker(temp, ["abc1234", "old9999", "latest", "test-fix", "<none>"]);
    const result = runLib(
      `deep_agent_gc_images deep-agent-service abc1234 old9999 && echo gc-done`,
      {},
      temp,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("gc-done");
    const commands = readFileSync(log, "utf8");
    expect(commands).toContain("rmi deep-agent-service:latest");
    expect(commands).toContain("rmi deep-agent-service:test-fix");
    expect(commands).not.toContain("rmi deep-agent-service:abc1234");
    expect(commands).not.toContain("rmi deep-agent-service:old9999");
    expect(commands).not.toContain("rmi deep-agent-service:<none>");
  });

  it("a failing rmi is logged but never reds the deployment (best-effort contract)", () => {
    const temp = tempDir();
    fakeDocker(temp, ["abc1234", "stuck-tag", "latest"], "stuck-tag");
    const result = runLib(
      `deep_agent_gc_images deep-agent-service abc1234 && echo deploy-continues`,
      {},
      temp,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("deploy-continues");
    expect(result.stdout).toContain("stuck-tag");
    expect(result.stdout).toContain("best-effort");
  });

  it("deploy.sh runs GC only after the new container proved ready", () => {
    const deploy = readFileSync(DEPLOY, "utf8");
    const gcAt = deploy.indexOf("deep_agent_gc_images deep-agent-service");
    const readyAt = deploy.indexOf("deep_agent_wait_graph_ready");
    expect(gcAt).toBeGreaterThan(0);
    expect(readyAt).toBeGreaterThan(0);
    expect(gcAt).toBeGreaterThan(readyAt);
  });
});

describe("DA-10 —— LangSmith 三件套投影（deploy.sh 4h 步的片段语义，rubric D10④）", () => {
  // 从 deploy.sh 提取投影片段在隔离 shell 里跑——与上面 read_env_value 的测法同一模式：
  // 不跑整个 deploy.sh（那需要 VM），只把「读 env → 校验 → 追加」这段逻辑在真 bash 下反证。
  const projectionScript = (envContent: string) => `
    set -euo pipefail
    source "${resolve(import.meta.dirname, "deep-agent-lib.sh")}"
    ENV_FILE=$(mktemp); printf '%s\n' "${envContent.replace(/"/g, '\\"')}" > "$ENV_FILE"
    OUT_FILE=$(mktemp); : > "$OUT_FILE"
    T=$(read_env_value "$ENV_FILE" LANGSMITH_TRACING)
    K=$(read_env_value "$ENV_FILE" LANGSMITH_API_KEY)
    P=$(read_env_value "$ENV_FILE" LANGSMITH_PROJECT)
    if [ -n "$T" ]; then
      if [ -z "$K" ]; then echo "MISSING_KEY" >&2; exit 1; fi
      { echo "LANGSMITH_TRACING=$T"; echo "LANGSMITH_API_KEY=$K"; echo "LANGSMITH_PROJECT=\${P:-workspacex-deep-agent}"; } >> "$OUT_FILE"
    fi
    cat "$OUT_FILE"
  `;

  it("三件齐 → 三行投影", () => {
    const r = spawnSync("bash", ["-c", projectionScript("LANGSMITH_TRACING=true\nLANGSMITH_API_KEY=lsv2_x\nLANGSMITH_PROJECT=proj")], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("LANGSMITH_TRACING=true");
    expect(r.stdout).toContain("LANGSMITH_PROJECT=proj");
  });

  it("未设 TRACING → 零投影（tracing 关闭，deep-agent.env 里不留空值假象）", () => {
    const r = spawnSync("bash", ["-c", projectionScript("KERNEL_MODEL_BASE_URL=http://x")], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("设了 TRACING 缺 API_KEY → 红退（写出去只会让服务空转上报）", () => {
    const r = spawnSync("bash", ["-c", projectionScript("LANGSMITH_TRACING=true")], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("MISSING_KEY");
  });

  it("PROJECT 缺省 → 默认 workspacex-deep-agent", () => {
    const r = spawnSync("bash", ["-c", projectionScript("LANGSMITH_TRACING=true\nLANGSMITH_API_KEY=lsv2_x")], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("LANGSMITH_PROJECT=workspacex-deep-agent");
  });

  it("deploy.sh 真文件里包含同一投影逻辑（防止片段测试与真脚本漂移）", () => {
    const deployText = readFileSync(DEPLOY, "utf8");
    expect(deployText).toContain("LANGSMITH_TRACING");
    expect(deployText).toContain("LANGSMITH_API_KEY");
    expect(deployText).toContain("却没设 LANGSMITH_API_KEY");
  });
});

/**
 * issue #2076 —— 引擎能力开关的 env 投影。
 *
 * Phase 14 F02（R6）：`DEEP_AGENT_SUBAGENTS_ENABLED` / `DEEP_AGENT_HITL_TOOLS` /
 * `DEEP_AGENT_TASK_AUTO_CLASSIFY` / `DEEP_AGENT_ASYNC_SUBTASKS_ENABLED` 四个键
 * 已从 harness.py/tools.py 移除（验证稳定后默认开启且开关本身移除），deploy.sh
 * 的白名单调用与 provision.sh 模板也随之摘掉这四行——下面用 `DEEP_AGENT_CHECKPOINT_DB`
 * （唯一留在白名单里、不属于本次移除范围的键，见 provision.sh 该键旁的说明）验证
 * `deep_agent_project_capability_env` 这个通用投影机制本身依然工作，另加一个合成
 * key 验证"设了就投影、不设就一行都不写"对任意 key 都成立，不只是对这一个键。
 *
 * 反证纪律（本仓已九次「全绿但空转」）：这里的核心用例不是"设了就写行"，而是
 * **不设就一行都不写**，以及 **deploy.sh 真的调了这个函数**——后者是这条 issue 的
 * 实际根因形态（函数写好了但没人调 = devapp 上 `docker exec ... env | grep '^DEEP_AGENT'`
 * 依旧零命中，与修之前逐字相同）。
 */
describe("deep_agent_project_capability_env — 引擎能力开关投影（#2076）", () => {
  const KEYS = "DEEP_AGENT_CHECKPOINT_DB DEEP_AGENT_SYNTHETIC_TEST_KEY";

  /** 建一对 src/dest，跑投影，返回 dest 的最终内容。 */
  function project(
    srcContent: string,
    keys: string = KEYS,
  ): { status: number | null; dest: string; stderr: string } {
    const temp = tempDir();
    const src = join(temp, "deploy.env");
    const dest = join(temp, "deep-agent.env");
    writeFileSync(src, srcContent);
    writeFileSync(dest, "KERNEL_MODEL_BASE_URL=http://x\n");
    const r = runLib(`deep_agent_project_capability_env '${src}' '${dest}' ${keys}`);
    return { status: r.status, dest: readFileSync(dest, "utf8"), stderr: r.stderr };
  }

  it("两个键都设了 → 两行都投影，值逐字保留", () => {
    const r = project(
      "DEEP_AGENT_CHECKPOINT_DB=postgresql://u:p@h:5432/db?sslmode=require\n"
      + "DEEP_AGENT_SYNTHETIC_TEST_KEY=call_skill, execute\n",
    );
    expect(r.status).toBe(0);
    // 值里带 `=` 和 `?` 不能被截断——read_env_value 只剥前缀。
    expect(r.dest).toContain("DEEP_AGENT_CHECKPOINT_DB=postgresql://u:p@h:5432/db?sslmode=require");
    expect(r.dest).toContain("DEEP_AGENT_SYNTHETIC_TEST_KEY=call_skill, execute");
  });

  it("反证：一个都不设 → dest 逐字不变（不留 `KEY=` 的空值假象）", () => {
    const before = "KERNEL_MODEL_BASE_URL=http://x\n";
    const r = project("KERNEL_MODEL_BASE_URL=http://x\n");
    expect(r.status).toBe(0);
    expect(r.dest).toBe(before);
    expect(r.dest).not.toContain("DEEP_AGENT_");
  });

  it("反证：设了 key 但值为空 → 同样不写行（空串投进去只会让人误以为开关配过了）", () => {
    const r = project("DEEP_AGENT_SYNTHETIC_TEST_KEY=\nDEEP_AGENT_CHECKPOINT_DB=postgresql://u:p@h:5432/db\n");
    expect(r.status).toBe(0);
    expect(r.dest).toContain("DEEP_AGENT_CHECKPOINT_DB=postgresql://u:p@h:5432/db");
    expect(r.dest).not.toContain("DEEP_AGENT_SYNTHETIC_TEST_KEY");
  });

  it("部分设置 → 只投影设了的那些，且在 stderr 报告投影了哪些（部署日志可对账）", () => {
    const r = project("DEEP_AGENT_CHECKPOINT_DB=postgresql://u:p@h:5432/db\n");
    expect(r.status).toBe(0);
    expect(r.dest).toContain("DEEP_AGENT_CHECKPOINT_DB=postgresql://u:p@h:5432/db");
    expect(r.dest).not.toContain("DEEP_AGENT_SYNTHETIC_TEST_KEY");
    expect(r.stderr).toContain("DEEP_AGENT_CHECKPOINT_DB");
  });

  it("反证（本 issue 的实际根因形态）：deploy.sh 真的调用了它，且在 docker run 之前", () => {
    const deployText = readFileSync(DEPLOY, "utf8");
    const callIdx = deployText.indexOf("deep_agent_project_capability_env");
    expect(callIdx, "deploy.sh 没调这个函数 = 开关依旧到不了容器").toBeGreaterThan(-1);
    expect(deployText).toContain("DEEP_AGENT_CHECKPOINT_DB");
    // 必须在容器起来之前投影完——写在 docker run 之后等于这一轮部署不生效。
    const runIdx = deployText.indexOf("docker run -d --name workspacex-deep-agent");
    expect(runIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeLessThan(runIdx);
  });

  it("Phase 14 F02（R6）：provision.sh / deploy.sh 白名单的真代码里已不存在 subagents/hitl-tools/task-auto-classify/async-subtasks 四个已移除的键", () => {
    // 剥掉 `#` 行注释再断言：这四个符号名字作为历史沿革仍然合法地出现在解释
    // "为什么被移除"的注释里（本文件头注同一条纪律），剥注释是为了不被这类合法的
    // 历史文档误伤。够用即可，不处理字符串字面量里恰好含 `#` 的边界情况。
    const stripShComments = (s: string) => s.replace(/#[^\n]*/g, "");
    const provisionText = stripShComments(readFileSync(PROVISION, "utf8"));
    const deployText = stripShComments(readFileSync(DEPLOY, "utf8"));
    const removedFlagNames = [
      "DEEP_AGENT_SUBAGENTS_ENABLED",
      "DEEP_AGENT_HITL_TOOLS",
      "DEEP_AGENT_TASK_AUTO_CLASSIFY",
      "DEEP_AGENT_ASYNC_SUBTASKS_ENABLED",
    ];
    for (const name of removedFlagNames) {
      expect(provisionText, `provision.sh 真代码里不应再出现已移除的开关符号 ${name}`).not.toContain(name);
      expect(deployText, `deploy.sh 真代码里不应再出现已移除的开关符号 ${name}`).not.toContain(name);
    }
    // DEEP_AGENT_CHECKPOINT_DB 不在这次移除范围内，留白理由不变（见 provision.sh
    // 该键旁的说明），继续保持注释态。
    expect(provisionText).not.toMatch(/^DEEP_AGENT_CHECKPOINT_DB=/m);
    expect(deployText).toContain("DEEP_AGENT_CHECKPOINT_DB");
  });
});
