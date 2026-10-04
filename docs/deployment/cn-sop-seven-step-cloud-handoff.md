# 固定 9b CN SOP：云端源码整合与本地证据

本次仅源码、mock 和本地隔离验证。APP `9b25bfa65662b96c0826fe67506b562ea46aa6d0`、BASE `ba6343199f3c834d6a198f83d0c771614292c82b`、release `2026.10.3-cn.1` 不变。没有生产安装、真实镜像构建/推送、生产 SQL、流量切换、IAM 或模型外发。baseline 255 replay 继续暂停，没有 qualified 替代。

云端接手：UTC `2026-10-04T15:52:05Z`；origin `https://github.com/boardx/workspacex.git`。初始干净 HEAD `64a92bf6c795a080c36c79207799ceded8b1456d`，随后真实 fetch PR5321 到独立 `/workspace/cn-sop`，base `4f2fe2c5724a607e2f3dc5dd2ece81a8754bc261`。Mac 两测试未推补丁独立复原，5754 bytes / SHA256 `28bc025f5df775cac123f5915f3355f06c61e61ec767c6dadbe499ff43e1eddb` 完全一致；21/21 实跑通过；提交 `eab4fd3b2`。

默认 pnpm 11.19.0 不符合 packageManager，使用 `/tmp/cn-sop-toolchain/node_modules/.bin/pnpm` 9.15.0。完整 init 被 canvas 原生构建和 Electron 下载阻断；发布 skill 允许的静态安装 `npm_config_ignore_scripts=true ./init.sh` exit0，快速健康检查通过；没有跨 worktree 链接 node_modules。tick 因 `COORD_GATEWAY_URL` 缺失退出1，未假称租约登记。测试 tmp 使用 `/workspace/cn-sop-test-tmp`；容器根目录 UID65534 的影响只在已有 non-root disposable test API 范围处理，生产 UID0 祖先信任检查保持。

| 步骤 | 源码交付 | 本地证据与边界 |
|---|---|---|
| 1 freeze | 复用 manifest/seal/tag，tag 加 exact expectedMainCnSha | 40项初验；旧 tag 不更新，缺新绑定必须新 attempt |
| 2 precheck | 固定包 COMPLETE/hash/FILES/Git closure 只读检验 | 31项初验，含篡改负例；安装不由预检授权 |
| 3 build/push/seal | 既有 publisher 自有 process-group TERM/INT/EXIT kill+wait | 18项初验，真实本地子孙进程；未调用 Docker 构建 |
| 4 isolated evidence | 复用既有八阶段 evidence producer | 新12+既有13初验；qualified/prepared/fullReady=false |
| 5 readiness | namespace/socket/cgroup、SNAT orig/reply、保留 PG 身份；TLS 调原权威 verifier | 参数化篡改/race负例；不改 APP 网络拓扑 |
| 6 maintenance | source-owned A-route、真实保留 session 的 candidate host transport、durable journal | 固定 actor ref，候选仅 resume；新 hold generation 派生仅 reblock；DDL intent前先 durable journal |
| 7 browser/open/observe | canonical8/browser6、前后 deployment marker、clear CAS 后 observe | 观察失败重新 hold/reblock/retain lock；不把健康检查当浏览器验收 |

生产 entry 的默认 legacy acceptance-writer gate 仍 fail closed。已提供 controller/typed A-route 入口与真实 candidate transport/retained actor 协议，但完整生产 A-route factory、当前 epoch evidence producer 实际运输与安装/profile 输入必须继续独审；本次不能宣称生产 READY。新 `candidateProviderReadOnly` 需要 exact root-private aliyun CLI hash/region/RAM role，缺失即拒绝，不借 ambient profile 或增 IAM。actor 与旧 journal/六连接复用，不是未来蓝绿或新 runner 平台。

## 每次运行时长：条件规划预算，尚非生产实测

下表在健康主机、已安装 exact 工具、有效离线 source、ACR 可达、暖构建缓存、无重试、三库数据量和 SQL 复杂度已通过演练预算的条件下给出窗口。它们是待实测校准的预算，不是承诺、P50/P95 或 mock 计时。任何数据量/吞吐/长锁未知都不满足该条件。首次固定9b目前没有 qualified replay，因此不能仅报“正常路径”就宣称可以上线。

| 步骤 | 正常每次预算 | 额外/未知条件 |
|---|---:|---|
| 1 freeze manifest/tag | 1–3 min | Devapp 真证据缺失或 tag 治理未验收不能计为正常 |
| 2 已安装工具只读预检 | 2–5 min | exact 新工具现场安装另列，不混入此行 |
| 3 build+push+seal | 12–28 min，目标≤30 min | 冷缓存35–75+ min；网络/依赖故障无保证 |
| 4 已 qualified artifact 复核 | 2–5 min | 必要实际隔离 replay/restore 另加30–120+ min，数据规模未知可更久 |
| 5 prepare/readiness | 3–8 min | 无 qualified/current epoch evidence 保持 NOT_READY |
| 6 当前 epoch backup/drain/migration/候选 held readback/resume | 12–30 min 条件窗口 | 须先有真实备份吞吐/恢复/SQL演练；规模未知不能据此安排停写 |
| 7 核心browser/CAS open/observe | 3–8 min | 真实ASR/GitHub/模型耗时及观察策略未实测；不执行外发 |

正常顺序关键路径约 **35–87 min**，不是开发工时。第3源码两波：`max(API build+push, Web build+push)` + `max(Agent build+push, Sandbox build+push, Postgres build+push)` + exact registry manifest/digest/seal；并行服务不重复相加。若两波分别≤12 min、seal/registry≤4 min，总≤28 min，可以落在30 min目标内；目前未实际构建，**不能证明或保证≤30 min**。需要真实 CPU/RAM/磁盘余量、镜像层大小、缓存命中、npm/PyPI/apt及ACR吞吐日志；旧15.1GiB可用磁盘数字仅交接，须现场重读。

| 统计口径 | 独立预算/状态 |
|---|---|
| 一次性现场安装准备 | 10–30 min条件预算；先做只读库存，再审 exact hash/旧新文件 CAS/profile/恢复；未执行 |
| 必要隔离演练 | 30–120+ min另列；baseline255暂停，无实测可用性结论 |
| 正常执行 | 35–87 min条件预算；不包含审批、runner排队、一次性安装或实际演练 |
| 首次本次固定9b | 正常 + 必要演练 + 安装 + 审批/排队，约75–237+ min只是条件预算；当前不具执行前提 |
| 停写 | 第6 barrier建立至候选精确resume验证，约12–30 min条件预算；备份/DDL未知时不能承诺 |
| 公网中断 | 与停写不同。源码hold只约束发布准入；读流量能否保留须实际应用/schema兼容验证。当前无实测上界，保守维护计划覆盖整个第6至browser恢复；不可宣传零中断/300秒维护迁移 |

演练可在生产维护前进行，但第4开始所需制品必须先完成第3；第6的当前epoch备份/恢复门在停写排空后，不可与旧快照复核并行以缩短预算。代码开发墙钟、本地mock毫秒均不用于以上预算。SOP维护窗口既有60/120分钟是规划值，不是此候选已达成的统计。

## 第二步现场请求：当前没有主机通道

云端实际检查未找到 aliyun CLI、阿里云连接工具或已授权SSH身份；仅有 `/usr/bin/ssh`。故现场工具/binding/资源/ACR检查未执行，没有现场 exit0。需要已授权的 CN `i-uf6ga92ewloganobbln6` / `cn-shanghai` 只读 Cloud Assistant/OOS/SSH 通道，以及最终冻结包、实际库存/provider/profile 收据；不需要把密钥贴在聊天里。

在现有授权通道中可运行以下只读命令，输出仍须脱敏。这里没有替代现场执行：

```bash
date -u '+%Y-%m-%dT%H:%M:%SZ'
/usr/bin/node --version
/usr/bin/docker version --format '{{.Server.Version}}'
/usr/bin/docker buildx version
/usr/bin/aliyun version
df -Pk /var/lib/docker /var/lib/workspacex-cn
free -m
stat -c '%u:%g %a %s %n' /usr/local/bin/workspacex-cn-build-candidate /usr/local/lib/workspacex-cn/cn-build-tool-identity.py /etc/workspacex-cn/trusted-tool-binding.json
sha256sum /usr/local/bin/workspacex-cn-build-candidate /usr/local/lib/workspacex-cn/cn-build-tool-identity.py
```

binding只读只输出toolRevision、文件数量和候选能力，不打印部署配置/secret/provider原文。ACR访问检查需固定registry/repository身份和既有认证通道；仅列仓库/鉴权manifest，不创建AGE repository、不装root文件、不改权限、不启动build。缺这些输入时不能拼一个假鉴权命令。

安装回退复用既有 `cn-tool-install-transaction.py`：旧文件存在/缺失、bytes/hash/inode/owner/mode快照与profile旧值，安装journal持久化，目标与profile双CAS，失败恢复旧bytes或原缺失状态，逐项hash读回。没有当前主机旧库存和backup包，不能给出真实恢复包hash或执行安装。最终源码closure记录单独冻结，review-only，不代表现场安装包 COMPLETE/host inventory/provided授权。

## 最终本地验收回执

UTC `2026-10-04T16:31:35Z` 汇总：cloud-deploy 52 files / 573 tests，29.05s；独立 host node:test 106 tests，2.250s；candidate host/writer/collector Python 48 tests，0.189s；源码冻结 create-once/篡改反例2 tests，0.596s；相关 harness 6 files / 79 tests，23.30s；安装 precheck/transaction/producer31 tests，1.729s；recovery fixture26 tests；包lint/typecheck、三个提交bundle check、bash -n、git diff --check均exit0。集合有嵌套，不把它们相加冒充唯一测试总数。全部来自本云环境的源码/mock/本地文件与进程，未启动生产/外部服务、真实provider模型或replay。

只读独立审阅未发现新增严重安全绕过，同时明确：`production_consumers.actualRuntime.assertActivationCapability` 仍硬拒，真实 `main` 不供应 `aRouteInputs`。这是具体尚未完成的生产源码总装，不是可用收据，也不因这轮本地测试而自动解除。Draft PR 保持该边界；后续需继续实现完整source-owned factory和当前epoch producer运输，并在真实qualified证据/独立授权齐备后另行现场验收。

原61 source/55 installed targets闭包增加唯一 `candidate_host_transport.py` 后为62/56（6 source-only）。最终 `cn-sop-seven-step-source-closure.json` 由exact Git commit字节生成；所有target及hash在该文件，raw文件hash在GitHub draft交付回执。它不包含主机旧库存、backup/rollback payload、provider/profile实际值或COMPLETE安装包，因此不是现场可安装包；禁止把它称作完成的正式安装冻结。
