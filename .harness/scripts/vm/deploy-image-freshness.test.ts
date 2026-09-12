/**
 * 2026-09-06 实测事故：**部署链从来不重建 `apps/skill-sandbox` 的镜像。**
 *
 * `docker compose up -d` 对带 `build:` 的服务只在**镜像不存在时**才构建；镜像已存在
 * 就直接复用，源码改了也不管。本机最小复现（busybox + 一行 `RUN echo v1 > /ver`）：
 * 改成 v2 之后 `up -d` 里读到的仍是 v1，加 `--build` 才变 v2。
 *
 * 后果不是「慢一版」：devapp 上的沙箱镜像自 2026-08-21 首次部署起就冻在那一版，之后
 * 所有改动（预装库、CJK 字体……）一次都没上去过。用户侧的症状与代码完全对不上——
 * API 是新的、按新 SKILL.md 教模型 `require('@pdf-lib/fontkit')`，沙箱是旧的、根本没
 * 这个包，于是「生成中文 PDF」必然失败，而 main 上的代码明明是对的。
 *
 * 这条测试把两件事钉成机械门控：
 * ① compose 那一行必须带 `--build`；
 * ② 起完之后必须对**跑着的容器**取一次动态事实（预装库 + 字体真的在里面），
 *   而不是只看 healthz —— 坏掉的那版沙箱 healthz 一直是 200（AGENTS.md
 *   「静态痕迹 ≠ 动态事实」的又一例）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOY = resolve(import.meta.dirname, "deploy.sh");
const COMPOSE = resolve(import.meta.dirname, "../../../apps/api/docker-compose.deploy.yml");
const DEV_COMPOSE = resolve(import.meta.dirname, "../../../apps/api/docker-compose.dev.yml");

const deployText = readFileSync(DEPLOY, "utf8");
const provisionText = readFileSync(resolve(import.meta.dirname, "provision.sh"), "utf8");
const nativeProbeText = readFileSync(resolve(import.meta.dirname, "native-session-probe.mjs"), "utf8");

/** deploy.sh 里那条把 compose 栈起起来的命令。 */
function composeUpLine(text: string): string {
  const line = text.split("\n").find((l) => l.includes("docker compose") && l.includes("up -d"));
  expect(line, "deploy.sh 里找不到 `docker compose ... up -d`").toBeTruthy();
  return line!;
}

describe("部署链必须把沙箱镜像重建成当前源码那一版", () => {
  it("MinIO dev/deploy 使用同一个可用的 Quay 发布镜像", () => {
    const image = (path: string) => {
      const compose = readFileSync(path, "utf8");
      const block = compose.slice(compose.indexOf("  minio:"), compose.indexOf("\n  redis:", compose.indexOf("  minio:")));
      return block.match(/^    image: (\S+)$/m)?.[1];
    };
    const expected = "quay.io/minio/minio:RELEASE.2024-09-13T20-26-02Z";
    expect(image(COMPOSE)).toBe(expected);
    expect(image(DEV_COMPOSE)).toBe(expected);
  });

  it("① compose up 带 --build（否则镜像一旦存在就永远不再更新）", () => {
    expect(composeUpLine(deployText)).toContain("--build");
    expect(deployText).toContain('SOURCE_REVISION="$SOURCE_REVISION"');
    expect(readFileSync(COMPOSE, "utf8")).toContain(
      "SOURCE_REVISION: ${SOURCE_REVISION:?set SOURCE_REVISION}",
    );
  });

  it("①a compose recreate 失败只清理可机械证明的 stopped sandbox 残留", () => {
    expect(deployText).toContain("reconcile_failed_sandbox_recreate");
    expect(deployText).toContain('[[ "$state" != running && "$state" != restarting ]]');
    expect(deployText).toContain(
      '[[ "$project" == workspacex && "$service" == skill-sandbox ]]',
    );
    expect(deployText).toContain('[[ "$image" == workspacex-skill-sandbox* && "$network" == none ]]');
    expect(deployText).toContain(
      '[[ "$candidate_image_id" == "$desired_image_id" && "$created" > "$deep_created" ]]',
    );
    expect(deployText).toContain('docker rm "$candidate"');
    expect(deployText).toMatch(/reconcile_failed_sandbox_recreate \|\| \{[\s\S]{0,300}exit 1/);
  });

  it("①b checkpoint probe prints only stable stage and exception class", () => {
    expect(deployText).toContain("python -m deep_agent_service.checkpoint_readiness");
    expect(deployText).not.toContain("checkpoint_readiness; then\n  >/dev/null 2>&1");
  });

  it("① 反证：把 --build 去掉，上面那条断言必须变红", () => {
    const withoutBuild = deployText.replace(" up -d --build", " up -d");
    expect(composeUpLine(withoutBuild)).not.toContain("--build");
  });

  it("② 起完之后对跑着的容器取动态事实：预装库与 CJK 字体都要真的在里面", () => {
    // 光有 --build 还不够：构建缓存、跑错 compose 文件、手工起的同名容器……都能让
    // 跑着的东西不是刚构建的那一版。所以要问容器本身，而不是问部署脚本自己。
    expect(deployText).toContain('for container in workspacex-skill-sandbox-1 "$NATIVE_SESSION_CONTAINER"');
    expect(deployText).toContain('docker exec "$container"');
    for (const probe of ["pptxgenjs", "docx", "exceljs", "pdf-lib", "@pdf-lib/fontkit"]) {
      expect(deployText, `沙箱自检漏了 ${probe}`).toContain(`require.resolve('${probe}')`);
    }
    expect(deployText).toContain("SKILL_SANDBOX_CJK_FONT");
    // 自检失败必须**红退**，不是打一行日志继续——半部署的沙箱正是这次事故的形态。
    expect(deployText).toMatch(/镜像不是当前源码构建的那一版[\s\S]{0,400}exit 1/);
  });

  it("②a socket healthz 在容器冷启动窗口内有限重试，并继续以服务用户检查", () => {
    expect(deployText).toMatch(/for i in \$\(seq 1 30\); do[\s\S]{0,500}sudo -u "\$RUN_AS" curl[\s\S]{0,500}sleep 1[\s\S]{0,200}done/);
    expect(deployText).toContain('if [ "$SANDBOX_HEALTH_READY" != "1" ]; then');
    expect(deployText).toMatch(/socket 存在但连不上[\s\S]{0,400}exit 1/);
  });

  it("②a 反证：退回单次 healthz 检查时，有限重试门控必须变红", () => {
    const oneShot = deployText.replace(
      /SANDBOX_HEALTH_READY=0\nfor i in \$\(seq 1 30\); do/,
      "SANDBOX_HEALTH_READY=0\nif true; then",
    );
    expect(oneShot).not.toMatch(/SANDBOX_HEALTH_READY=0\nfor i in \$\(seq 1 30\); do/);
  });

  it("②b 续行中间不许插注释行——插了会静默截断命令并把密钥打进日志", () => {
    /*
     * 2026-09-06 实测：给上面那条 compose 命令加说明时，注释写进了 `\` 续行之间。
     * shell 于是在注释处截断命令：
     *   · `env` 没拿到任何命令 ⇒ 退化成"打印当前环境"，把 `SUDO_COMMAND=...`
     *     （含 deploy.env 全部密钥：DB 口令、S3 密钥、模型 API key…）原样打进 CI 日志；
     *   · 紧随其后的 `docker compose` 变成一条独立命令，以 root 而不是 $RUN_AS 跑。
     * 两件事都不报错，`bash -n` 也查不出来——语法完全合法，只是意思变了。
     *
     * ⇒ 用一条最朴素的机械规则挡整类问题：以 `\` 结尾的行，下一行不许是注释。
     */
    for (const file of ["deploy.sh", "provision.sh", "deploy-gate.sh"]) {
      const lines = readFileSync(resolve(import.meta.dirname, file), "utf8").split("\n");
      for (let i = 0; i < lines.length - 1; i += 1) {
        const current = lines[i]!;
        // 注释行自己也可以以 `\` 结尾（头注里的用法示例就是），那不是续行，跳过。
        if (current.trimStart().startsWith("#")) continue;
        if (!current.trimEnd().endsWith("\\")) continue;
        expect(
          lines[i + 1]!.trimStart().startsWith("#"),
          `${file}:${String(i + 2)} 是一条注释，却跟在续行 \`${current.trim()}\` 后面`,
        ).toBe(false);
      }
    }
  });

  it("②b 反证：人为构造「续行后跟注释」，上面那条规则必须抓得到", () => {
    const poisoned = ["cmd a \\", "# 说明", "  b"];
    const caught = poisoned.some(
      (line, i) =>
        line.trimEnd().endsWith("\\") && (poisoned[i + 1]?.trimStart().startsWith("#") ?? false),
    );
    expect(caught).toBe(true);
  });

  it("④ 字体路径只声明在镜像里——compose 不许再写一份（一个事实一处声明）", () => {
    /*
     * 2026-09-06 实测事故：`SKILL_SANDBOX_CJK_FONT` 同时写在 Dockerfile 与两份 compose 里。
     * 换字体时只改了 Dockerfile，容器于是拿着一个**已经不存在的**路径跑——镜像明明是新的、
     * 字体明明装好了，部署自检却红在"文件不存在"上，非常难读。
     *
     * 修法不是"记得两边一起改"（那是本仓栽过五次的那条），是**删掉副本**：路径由镜像的
     * ENV 给，compose 只负责它自己那份运行参数（socket / modules / tmpfs）。
     */
    for (const file of [
      "../../../apps/skill-sandbox/docker-compose.sandbox.yml",
      "../../../apps/api/docker-compose.deploy.yml",
    ]) {
      const yaml = readFileSync(resolve(import.meta.dirname, file), "utf8");
      const declarations = yaml
        .split("\n")
        .filter((line) => !line.trim().startsWith("#") && line.includes("SKILL_SANDBOX_CJK_FONT"));
      expect(declarations, `${file} 又声明了一份字体路径：${declarations.join(" / ")}`).toEqual([]);
    }
    // 反面：镜像里必须有这唯一的一份。
    const dockerfile = readFileSync(
      resolve(import.meta.dirname, "../../../apps/skill-sandbox/Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toMatch(/SKILL_SANDBOX_CJK_FONT=\S+/);
  });

  it("③ compose 里 skill-sandbox 确实是 build: 出来的（本门控的前提）", () => {
    // 哪天它改成从 registry 拉固定 tag 的镜像，本文件这套断言的前提就不成立了，
    // 该换成"tag 与当前 SHA 一致"的检查——所以把前提也钉住，不让它无声漂移。
    const compose = readFileSync(COMPOSE, "utf8");
    const sandboxBlock = compose.slice(compose.indexOf("skill-sandbox:"));
    expect(sandboxBlock).toContain("build:");
    expect(sandboxBlock).toContain("context: ../skill-sandbox");
  });
});

describe("#2929 DevApp native session topology", () => {
  it("runs a separately confined sessions-only sandbox over one host UDS directory", () => {
    const compose = readFileSync(COMPOSE, "utf8");
    const native = compose.slice(compose.indexOf("skill-sandbox-sessions:"));
    expect(native).toContain('network_mode: "none"');
    expect(native).toContain("read_only: true");
    expect(native).toContain("cap_drop:");
    expect(native).toContain("- ALL");
    expect(native).toContain("no-new-privileges:true");
    expect(native).toContain("seccomp=../skill-sandbox/security/docker-seccomp.json");
    expect(native).toContain("apparmor=workspacex-native-sessions");
    expect(native).toContain("SKILL_SANDBOX_SESSIONS_ONLY: \"1\"");
    expect(native).toContain("${NATIVE_SESSION_SOCKET_DIR:?set NATIVE_SESSION_SOCKET_DIR}:/run/sessions");
    expect(native).not.toContain("docker.sock");
  });

  it("loads the persistent AppArmor policy before compose and probes the actual sessions-only endpoint", () => {
    const profileAt = deployText.indexOf("apparmor_parser -r -W");
    const composeAt = deployText.indexOf("docker compose -f apps/api/docker-compose.deploy.yml");
    expect(profileAt).toBeGreaterThan(-1);
    expect(profileAt).toBeLessThan(composeAt);
    expect(deployText).toContain("native-session-probe.mjs");
    expect(deployText).toContain("workspacex-skill-sandbox-sessions-1");
    expect(nativeProbeText).toContain('request("POST", "/sessions"');
    expect(nativeProbeText).toContain('request("POST", "/run"');
    expect(nativeProbeText).toContain("status !== 404");
    expect(nativeProbeText).not.toMatch(/console\.(log|error).*token/);
    expect(provisionText).toContain("apparmor_parser");
  });

  it("mounts only the native socket directory read-only into Deep Agent and never passes the binding key", () => {
    const runAt = deployText.indexOf("docker run -d --name workspacex-deep-agent");
    const runBlock = deployText.slice(runAt, deployText.indexOf("# 健康检查①", runAt));
    expect(runAt).toBeGreaterThan(-1);
    expect(runBlock).toContain('-v "${NATIVE_SESSION_SOCKET_DIR}:/run/native-sessions:ro"');
    expect(runBlock).toContain("--add-host workspacex-api-host:host-gateway");
    expect(runBlock).not.toContain("docker.sock");
    expect(runBlock).not.toContain("NATIVE_SESSION_BINDING_KEY");
    expect(deployText).toContain("deep_agent_project_native_env");
    expect(deployText).toContain("native_runtime_assert_deep_agent_container");
  });

  it("checks the restarted API process env and reports only boolean key state", () => {
    const restartAt = deployText.indexOf("systemctl restart workspacex-api workspacex-web");
    const probeAt = deployText.indexOf("native_runtime_assert_api_env_file");
    expect(restartAt).toBeGreaterThan(-1);
    expect(probeAt).toBeGreaterThan(restartAt);
    expect(deployText.indexOf("native_runtime_assert_deep_agent_api_callback")).toBeGreaterThan(restartAt);
    expect(deployText).toContain("binding-key=PRESENT");
    expect(deployText).toContain("service-key=PRESENT");
  });
});
