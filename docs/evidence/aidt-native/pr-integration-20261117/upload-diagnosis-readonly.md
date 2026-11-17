# DevApp AIDT 镜像上传超时：独立只读诊断

结论：本次五个服务的 Docker build 均实际完成，登录步骤成功；失败发生在随后 docker push 的 **720 秒硬截止**。已看到部分层 Pushed/Layer already exists，不能归因为整个 ACR 不可达、凭据完全无效或应用编译失败。上传未完成的具体网络原因仍未建立；没有 DNS/IP、代理配置、HTTP 错误码、各层字节数或速率证据，不能把“跨区域”直接写成根因。

本次只经 GitHub MCP 读取真实日志/steps、读取源码、写这份工作区证据；没有 credential value 读取、Docker/registry 调用、dispatch、rerun、构建或部署。所有新文件均在 `/workspace`，没有写工作区外的诊断产物。父任务与 release owner 已收到结果。

## 实际运行与逐服务证据

[Run 44000938132](https://github.com/boardx/workspacex/actions/runs/44000938132)，control checkout `50d0633eca9d8744ffdc87126092beef66736bff`，被构建 source `27b305e607281e54b4cf905269e30e26a35bee9e`，tag `44000938132-90000000000000000001`。MCP jobs 当前返回五个 build failure，manifest/deploy skipped；登录和清理步骤均 success，结果 artifact 上传均 skipped。源端只构建/发布，没有进入部署。

| 服务 / 实际 job | build 秒 | push 到终止秒 | 准备层 / Pushed / exists | 未见完成记录 |
| --- | ---: | ---: | --- | --- |
| [api / 133764890499](https://github.com/boardx/workspacex/actions/runs/44000938132/job/133764890499) | 64.787 | 720.110 | 24 / 17 / 5 | `a0524d3d13b7`、`1d7b9dd8778e` |
| [agent / 133764890520](https://github.com/boardx/workspacex/actions/runs/44000938132/job/133764890520) | 12.484 | 720.086 | 9 / 4 / 3 | `47025b86c6c8`、`dd57f90311a2` |
| [postgres / 133764890545](https://github.com/boardx/workspacex/actions/runs/44000938132/job/133764890545) | 41.888 | 720.030 | 17 / 1 / 15 | `1d7b9dd8778e` |
| [sandbox / 133764890427](https://github.com/boardx/workspacex/actions/runs/44000938132/job/133764890427) | 141.403 | 720.088 | 29 / 16 / 0 | 13 层，含 `1d7b9dd8778e`，见 JSON |
| [web / 133764890370](https://github.com/boardx/workspacex/actions/runs/44000938132/job/133764890370) | 226.072 | 720.068 | 11 / 5 / 5 | `1d7b9dd8778e` |

计数按实际输出中唯一 progress ID，`未见完成` 是未看到该 ID 的 Pushed/exists，不是已测量其上传字节为零。四个服务共同缺 `1d7b9dd8778e` 的完成记录，值得优先关联镜像 geometry；目前没有其大小或与基础镜像层的直接映射，不能凭共同 ID 宣称“已确定是最大 Debian 基础层”。Web/PG 各仍有一个层未完成，不能说全部层已传完只卡 manifest。五个日志都没有最终 manifest digest；超时也不证明远端 tag 一定不存在。

阶段原时间、层 ID 列表与计数在同目录 [upload-diagnosis-proof.json](upload-diagnosis-proof.json)。没有保存整份原日志或凭据文本；原始日志由上列 GitHub job 链接保留。

## 实际网络事实与反证

- 真实 runner 为 GitHub hosted Ubuntu 24.04 / AWS：API、Agent、Sandbox、Web 在 `us-west-2`，Postgres 在 `us-east-1`。镜像版本 `20261111.127.1`。
- 实际 registry 是公网 `workspacex-cn-prod-registry.cn-shanghai.cr.aliyuncs.com`，仓库前缀 `/workspacex-prod`。域名包含 prod 是 registry/repository 名称，本次目标仍是 devapp，不能把它等同发生生产部署。
- login 脚本明确拒绝 `-vpc.` 地址，本轮登录 step success；多层 Pushed 是实际 repository 写入进展。未见 unauthorized/denied、明确 TLS 错误、429、上传重试、代理变量或 Docker daemon proxy 记录。未记录不等于没有代理，也不能推断代理异常。
- Release owner 提供历史成功对照后，本 worker 独立 fetch 了 [43758477392 / Web job 132947916149](https://github.com/boardx/workspacex/actions/runs/43758477392/job/132947916149) 的日志与 steps：同 AWS us-west-2、同 runner image、同 registry、同三个基础镜像 pins，Build and publish service 与 artifact upload 均 success。因此“AWS 该区域一概不能上传到此 ACR”的解释有直接反例。历史成功的 push stdout 未被打印，不能据此宣布本轮未完成的那个层以前一定成功上传过。

没有读取本地模型运行环境的代理/证书值。之前 S2 的本地 TLS 故障与这次独立 hosted runner 的 registry 上传没有已证明因果关系。

## Docker geometry 与确定存在的代码诊断缺口

源码 `scripts/registry-images.py:149` 使用 buildx `--load --platform linux/amd64`，随后独立 docker push，`165` 固定 720 秒。`run():85` 采用 `subprocess.run(capture_output=True)`；`run_release_stage():128-135` 直到 TimeoutExpired 才回显有界尾部。

因此日志里的所有层状态都带 **截止时刻** 的 GitHub 时间，既不是各层真正完成时间，也不能计算首字节/最后进展间隔。成功阶段输出也会被丢弃。此缺口是源码及实际日志共同证明的，修复它比单纯延长总超时更有依据。

source 27b 的 geometry 约束：Web runtime 是新的干净 Node 基础层加 standalone/public/static；API runtime 沿用 sources stage 并装生产依赖；Sandbox runtime 在 Node 上加入 Office、字体、OCR/音频和 Python analysis 资产；Agent 是 Python slim 加 uv/venv；Postgres 是 pinned pgvector 加 AGE。层数量/依赖来源不同，构建耗时不等于上传字节数，不能按这五个 build 时间推上传速率。

最小建议代码增量（本轮不写源码）：

1. 针对 push 用流式读取器输出**白名单结构化进度**：layer ID、固定状态、相对秒数、完成/总层数和最后状态变化年龄；每 30 秒有界 heartbeat。未知文本继续按既有 safe_diagnostics 保密有界处理，不开 Docker daemon 全量 debug，不直通未经处理的 headers/URLs/环境。保留单次执行和明确总 deadline，先不自动重试推送。
2. build 成功、push 之前只收安全 geometry：实际 image ID、总 size、RootFS layer IDs/数量；如需逐层大小，用不含 CreatedBy 的 history size/ID 与 config 非空历史映射，禁止整个 image inspect dump（其中可能有环境和其他敏感字段）。与已固定 base pin 对照后再判共同层归属/大小。
3. timeout 记为上传结果未知，先做精确五个 tag 的只读 manifest/OCI source+release-tag 读取及 digest 对照；不要因 timeout 自动重放或把 partial blobs 当完整镜像。已有 manifest/deploy fail-closed 保留。

适合本地无网络测试的反例包括：部分层推进后静默、持续推进但总预算耗尽、unknown 输出保密、stdout/stderr 分块、cancel/timeout 恰好一次终端、无隐式 push retry、geometry 不输出 Config.Env/CreatedBy。没有足够证据现在修改 registry 地址、关闭 TLS、放宽权限、改代理、替换 push 后端或断言降低并发即可修复；这些须根据最小探针后的差异选一项验证。

## 已存在的最小 canary 方案，尚未执行

`.github/workflows/build-cn-release-artifacts.yml:179-212` 已有 registry-probe job。若 root 后续获得执行授权，可只 dispatch 该既有 workflow：`registry_probe_only=true`、`host_permission_probe=off`、`shared_images_only=false`，固定已审阅的 workflow ref，并填其必填 release_sha/release/platform/source_branch。注意该 probe 的 checkout 使用 workflow ref，**不是** release_sha；填 release_sha 不能代替审阅所运行的 workflow 字节。

该 job 仅 hosted runner，10 分钟上限，使用现有授权 login；FROM scratch + 单个 run/attempt marker，独立 `api:acr-probe-<run>-<attempt>` tag，push 后 pull 并比对 image ID，always 删除其临时 DOCKER_CONFIG。应用 validate/seal/shared-images 和 self-hosted host-permission 路径均不进入，也不触及模型、业务 DB 或部署。

它仍会在真实 registry 的 api repository **新增诊断 tag/blob**，不是只读动作，本 worker 未 dispatch。成功只证明这次 tiny layer 的 login/push/pull，不证明共同未完成层或 Sandbox 大层能上传；失败则保留实际 status/elapsed 再定位。现有 workflow 不收带宽/代理/分层字节信息，因此应先完成失败五 tag 的只读 reconcile，再选择一次 tiny canary；若 tiny 成功，下一步为一个服务单独 build-only 的 geometry/进度验证，而非五服务盲目重跑。
