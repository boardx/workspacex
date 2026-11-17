# E003 两项 Python 集成测试：只读预检

检查时间：2026-11-16 21:19 UTC。状态：**尚未补验；本机缺少真实 E003 容器及镜像缓存**。本次仅阅读代码、容器／镜像元数据、Compose 展开配置及磁盘状态；没有 build、pull、run、起服务、修改主 API 开关或调整角色／余额。

**最终状态更新：**root 已在两次磁盘底线停止后终止本轮续构建。当前最终阻塞是**现有独立构建存储无法在保留 1.5 GiB 空闲的条件下完成完整镜像**。原代理／严格 TLS／APT CA 可读性问题已有实际因果修正，不能继续将最早 `Errno 101` 当作唯一现因。真实 E003 镜像／隔离 probe／容器未 ready，两项 pytest 执行数为 0，原 2 项 skip 继续保留，不能计通过。最终回执见 [e003-final-blocked.json](../a1/e003-final-blocked.json)。

## 两项 skip 需要什么

- `apps/deep-agent-service/tests/test_native_graph.py::test_real_pinned_skill_executes_in_isolated_session`：ScriptedModel 提出真实读取已挂载 Skill 和执行 Python 脚本的工具调用，通过真实 E003 下载核对 `PINNED_SCRIPT_EXECUTED`。
- `...::test_real_execute_waits_for_official_approval`：真实 E003 文件在官方 LangGraph interrupt 前不存在，`Command(resume=approve)` 后才出现。
- `tests/native_sandbox_fixture.py:42–44` 仅在没有 `WX_NATIVE_SANDBOX_CONTAINER` 时 skip；设置变量必须指向**明确自有、实际运行的 E003 容器**。fixture 通过 `docker exec -i <container> node` 中继 Unix socket，真实创建／删除单个 session；不能填 host PID、HTTP URL 或无关容器名来绕过。
- 两项使用 `ScriptedModel`／`GenericFakeChatModel`，不是供应商模型；`FakeAuthority` 是显式测试夹具。可补真实沙箱／官方图中断集成，不证明模型效果、生产审批权限或浏览器审批流程。无需收费模型或主 API 开关。

## 当前实际资源

| 项目 | 只读结果 |
| --- | --- |
| Docker／Compose | Docker 28.4.0，linux/amd64；Compose v2.40.3，满足 `!override` 要求 |
| 现有容器 | 仅本轮 owned PostgreSQL、Redis、Minio；无 E003 |
| 镜像缓存 | `workspacex-skill-sandbox:e003`、`node:22-slim`、`python:3.11-slim` 均 `No such image`；没有 sandbox 镜像缓存 |
| 磁盘抽样 | `/workspace` 与 Docker 共用 overlay；可用 4,782,178,304 字节，约 4.45 GiB，使用率 86% |
| 主机能力 | 有 bubblewrap 0.12.0；Docker security options 是 builtin seccomp／cgroupns，未报告 AppArmor；尚未执行本机 E003 内核探针，不能声称隔离已通过 |
| 主机 E003 资源 | 没有 `/opt/sandbox/session-seccomp.bpf` 或 `/opt/sandbox/node_modules`，不能以 host 执行替代 |
| Python 测试解释器 | 既有 `/workspace/scratch/aidt-real-model-20261116/python/bin/python` 可执行，venv 记录 Python 3.12.14；无需新安装模型依赖 |

环境 owner 另外确认：当前启动链来自 `e2e-up.sh` 的 host pnpm／Node HTTP skill-sandbox，源码为 `apps/skill-sandbox/src/main.ts`，TCP 26555 可连；它不是 Docker E003／UDS session。旧 pidfile wrapper 已退出，不能用它冒称 live container owner。本预检未重启或终止该服务。

现成 `docker-compose.sessions.yml` 的**实际展开配置**保留 `network_mode=none`、只读 rootfs、`user=node`、`init=true`、cap-drop ALL、no-new-privileges、专用 `docker-seccomp.json`、256 MiB noexec/nosuid tmpfs、1 GiB 内存／swap 上限、1 CPU、128 PID，以及独立 `/run/sessions` volume；没有公开端口。不能改成 privileged、unconfined、host network 或增配 capability 来通过测试。

## 缺口与磁盘估计

1. 需要 owner 决定取得真实 E003 镜像：当前没有可直接复用的缓存，也没有本轮给定且可拉取的已审阅远程 sandbox 镜像地址／digest。历史文档的本地 tag 和 manifest hash不是一个可凭空推定的远程 registry 地址。
2. 从现有 Dockerfile 冷构建需要 Node／Python 基础镜像、NPM、hash-locked PyPI wheels、APT；运行层还包含 LibreOffice、OCR、ffmpeg 和科学计算库。它不是只安装一个小型 Python 测试包。
3. **规划估计而非实测**：完整运行镜像新增约 1.5–3 GiB，冷构建连同分析层、包下载与缓存的峰值约 3–6 GiB；具体镜像层共享、registry 和 APT 依赖会改变结果。当前 4.45 GiB 可能不足以同时保留安全余量，不能保证构建不会占满。若用预构建镜像，仍需核对其实际大小／源码／架构及空间。
4. Dockerfile 的默认基础镜像 tag 可变，部分 Debian 包有精确版本约束；尚未拉取／构建，不能声称当前远程镜像和包索引兼容或 build 一定成功。这里没有替换镜像、放宽包锁或清理其他 agent 数据。
5. 容器正常运行的两个小 session／测试文件开销远小于镜像构建；配置中 256 MiB tmpfs 是内存文件系统上限，不应当作新增持久镜像空间。owner 仍须先登记独立容器／volume，检查内存和构建磁盘预算。

## owner 决定补验后可执行的最小路径（未执行）

以下复用仓库已有配置，不触主 API。项目名前缀来自本轮实际隔离 scope，另加 `-e003`；应由 owner 再核对名称无冲突并登记资源。`SOURCE_REVISION` 只标识构建源码；实际镜像 ID、输入 digest、隔离探针和测试结果须另行记录，不能只凭标签通过。

```bash
cd /workspace/aidt-module-latest
aidt_e003_project=wsx-1e261c1b8eacf1988f72-e003
aidt_e003_container=${aidt_e003_project}-native-test
aidt_e003_compose=$PWD/apps/skill-sandbox/docker-compose.sessions.yml
aidt_e003_python=/workspace/scratch/aidt-real-model-20261116/python/bin/python

# 仅在 owner 批准镜像获取、构建资源和空间后执行；沿用当前 Dockerfile。
docker compose -p "$aidt_e003_project" -f "$aidt_e003_compose" build \
  --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" skill-sandbox-sessions

# 先跑仓库真实隔离探针：单独自有临时容器，执行完自动删除。
docker compose -p "$aidt_e003_project" -f "$aidt_e003_compose" run --rm --no-deps \
  -e SKILL_SANDBOX_SOCKET=/tmp/isolation-check.sock \
  --volume "$PWD/apps/skill-sandbox/tests/session-container.mjs:/session-test.mjs:ro" \
  --entrypoint node skill-sandbox-sessions /session-test.mjs

# 探针通过后，仅启动本任务的无网络 sessions 服务；不启动 API／数据库。
docker compose -p "$aidt_e003_project" -f "$aidt_e003_compose" run --rm -d --no-deps \
  --name "$aidt_e003_container" skill-sandbox-sessions
docker exec "$aidt_e003_container" test -S /run/sessions/skill-sandbox.sock

cd apps/deep-agent-service
# 干净测试环境，不 source 模型配置；仅保留既有正常 Docker client 的基础环境。
env -i PATH="$PATH" HOME="$HOME" PYTHONPATH=src \
  WX_NATIVE_SANDBOX_CONTAINER="$aidt_e003_container" \
  "$aidt_e003_python" -m pytest -q \
  tests/test_native_graph.py::test_real_pinned_skill_executes_in_isolated_session \
  tests/test_native_graph.py::test_real_execute_waits_for_official_approval
```

若此 Docker client 需要专用 `DOCKER_HOST`／`DOCKER_CONTEXT`，应由 owner 只传递实际连接设置；不能引入模型 key。socket 未就绪、探针失败、HTTP 503 或执行被拒绝均应保留失败，不能跳过、改成 host 执行或削弱隔离再计通过。此主机没有报告启用 AppArmor，不应为这两条测试擅自载入 CI 的 host AppArmor override 或修改宿主策略。

结束后只清理本任务已登记的资源；保留日志／镜像 ID／测试报告：

```bash
docker stop "$aidt_e003_container"
docker compose -p "$aidt_e003_project" -f "$aidt_e003_compose" down --volumes
```

不得运行全局 prune、清除主栈卷、改旧账本或回填这两条测试为通过。**目前结论仍是 2 项未执行／缺真实 E003 依赖；本预检不是补验成功。**

## 后续授权与执行边界

root 随后授权由 sole environment owner 尽力进行**一次**冷构建：先仅回收本轮 fresh Next cache，保留正在运行产物的 server／static／BUILD_ID；构建上限 15 分钟，空闲空间低于 1.5 GiB 即停止。不得全局 prune、调整 daemon／registry 权限或 CA，不得弱化既有隔离。证书、网络或依赖资产受限时保留首个真实失败，结束而不重复重试。

本 agent 已将上述现有资产／probe 命令交 owner；只有 owner 确认真实容器与 probe ready 后，才运行这两项现有 pytest。该授权不代表镜像已构建、probe 已通过或 2 项 skip 已补验；后续实际结果须另行保存，旧记录继续保留。

## 前次实际结果：一次冷构建被网络阻塞，补验未执行

owner 的脱敏原始回执：[e003-cold-build-blocked.json](../a1/e003-cold-build-blocked.json)，结束于 2026-11-16 21:29:15 UTC。

- 首次 CLI 在 2 秒内因只读 `/home/agent/.docker/buildx` 初始化失败，尚未开始实际镜像／网络构建；原记录保留。root 随后明确允许使用自有 0700 空 `DOCKER_CONFIG` 修复本地 launcher 路径。没有修改 HOME、daemon、registry 权限／凭据或 CA。
- 首次实际冷构建（CLI 2）耗时 72.02 秒，退出码 1。基础镜像匿名拉取成功，但官方 Dockerfile 的 analysis 阶段访问 PyPI `/simple/cffi/` 返回 `Errno 101 Network is unreachable`，hash-locked pip 安装终止。
- pip 随后显示 `cffi==2.1.1` 无匹配分发，但在索引无法连接的情况下，**不能据此判定版本不存在或锁文件错误**。日志中 pip 自带的连接重试不是新增 cold-build 尝试；owner 当时按该次授权停止，后续仅依 root 追加授权作因果修正续行。没有用 host network、证书绕过或依赖降级补绿。
- 构建前空闲 7,345,750,016 字节，失败后 5,208,506,368 字节；没有达到 1.5 GiB 停止线，也不是 15 分钟超时。此次未完成镜像，不能用部分构建的耗用反推完整镜像一定有足够空间。
- 实际 E003 镜像／容器未就绪，官方 probe **未执行**，两项 pytest **执行数为 0**。原有 2 项 skip 保留，当前仍记基础设施依赖阻塞，不记测试通过或产品断言失败。不使用 host HTTP sandbox 代替。
- owner 核实本任务剩余 labeled 容器、卷、网络、镜像均为 0；未全局 prune，部分共享 builder cache 未删除。模型请求 0，API／Web 未重启，安全 guard 未改。

私有完整日志 SHA256：`50e5ee728058e6f8ff6bec9c6a0f438c0a96a9e029028b806f9e8d28366c0dac`。该次授权范围内已停止；后续获新授权的因果修正与结果另记，不能覆盖这次阻塞与原 skip。

## 后续因果修正与最终磁盘停止

root 后续明确授权 owner 仅恢复原 Docker 配置中的 `proxies.default` 到自有私有配置，并通过 scratch Dockerfile 的每个构建 RUN 只读挂载 combined CA secret、使用 `PIP_CERT`／`NODE_EXTRA_CA_CERTS` 保持严格 TLS；不复制旧 registry auth，不改变生产 Dockerfile、依赖锁、runtime 的 none network／只读／非 root／cap-drop／NNP／seccomp。npm／pip 原网络失败已实际消失。可逆归档旧自有生成 cache 实际回收约 5.49 GB 后仍再次触及磁盘底线；APT dropped user 的公开 CA 可读性也已按追加授权修复，secret 保持只读、扫描无 PRIVATE KEY，不 COPY 入镜像层。以下各次原始失败均保留，构建期网络或 CA 修复不等于 probe 或两项 pytest 通过。

测试解释器的额外实际前提也已校正：原运行 venv 没有 pytest。为不改变运行依赖，owner 仅在 `/workspace/scratch/aidt-remediation-20261117/qa-tools` 准备锁定的 pytest 9.1.1／pytest-timeout 2.4.0。若容器与 probe ready，测试将以干净环境运行原 exact 两条用例，`PYTHONPATH` 使用该 QA target 加仓库 `apps/deep-agent-service/src`；不是向运行 venv 安装或替换依赖。原 skip、首 CLI 失败、原网络失败及后续资源停止均保留。

### 最终实际记录（2026-11-16 22:02 UTC）

| CLI 次数 | 是否进入 BuildKit | 用时／退出 | 实际结果 |
| --- | --- | --- | --- |
| 1 | 否 | 2.00 秒／1 | 本地只读 HOME 下 buildx cache 初始化失败 |
| 2 | 第 1 次 | 72.02 秒／1 | 私有空 Docker 配置遗漏原代理，PyPI `Errno 101`；原日志保留 |
| 3 | 第 2 次 | 4.00 秒／1 | owner 临时构建 RUN 适配的语法错误，未冒充产品源错误；原日志保留 |
| 4 | 第 3 次 | 18.01 秒／130 | 自动磁盘底线停止，停止时可用 1,493,233,664 字节 |
| 5 | 第 4 次 | 6.00 秒／1 | APT dropped user 无法读取只读 CA secret；CaInfo 为根因，Release 错误为次生；原日志保留 |
| 6 | 第 5 次 | 64.03 秒／130 | 修复公开 CA 可读性后再次自动磁盘底线停止，可用 1,535,483,904 字节 |

总容量为 33,770,192,896 字节；最后一次从 7,429,779,456 字节空闲开始，仍未完成完整镜像。最终是存储预算阻塞，不是保留中的最早网络／CA 错误仍未修复。root 已明确本轮不再授权 E003 构建；不得再修改 Docker data-root、daemon、安全策略或全局 prune 追求通过。

最终 owner 回执确认：所有本任务 build PID 已不存在；剩余 owned 容器／卷／网络／labeled 镜像均为 0；官方 probe 0 次、两项 pytest 0 次；模型请求 0。保留全部失败日志、markers、私有诊断与可逆 cache archives，未把两个 skip 改为通过，也不使用 host HTTP sandbox 代替。未来若补验，需要更大的独立 Docker 构建存储、保持底线与同样严格的代理／只读信任／隔离配置，并在真实官方 probe 通过后再执行原两条测试。
