# 固定 9b：前 1–3 步独立关键路径与批准清单

本清单仅覆盖 freeze → 固定工具安装/precheck → artifact-build/build/push/seal。第 4–7 步、baseline255 合格 replay、迁移、生产 prepare 与 activation 不作为 artifact-build 前置。实际安装、root 权限及新仓库尚未获具体确认；本清单不授权执行。

## 固定内容及机械回执

- APP `9b25bfa65662b96c0826fe67506b562ea46aa6d0`。
- BASE `ba6343199f3c834d6a198f83d0c771614292c82b`。
- release `2026.10.3-cn.1`。
- 已提交工具源码 snapshot `987bc023660e4e03363d549c0376f55334cb5328`；所属 Draft #5337 当前远端 `868ca9ffc3f306c7fba6a3805ecc231acc53ec83`。不使用 latest，也不收录 agents 未提交的后续 4–7 文件。
- 对 `cn-build-tool-identity.py` 的 FILES 对应 62 个 exact Git blobs 逐项重新验证 bytes/SHA256：62 source、56 unique installed targets、6 source-only。冻结 inventory SHA256 `eff56187be0bcfa41bdfa600fd8d8681f60ba1464bb9653ee57ca4fe0de2ef0c`。
- 独立 deterministic review tar：`/workspace/cn-stage123-review/source-only-review.tar`，1,402,880 bytes，SHA256 `a37c3a3773fd9f8de19f705f0c0be988c3a942b1ae48a87bb76e2b06a0050153`。逐字 Git 校验回执 `/workspace/cn-stage123-review/mechanical-verification.json`。

该 tar 是 source-only review package，不是 installer COMPLETE package。目标文件列表及逐项 newSha256 已精确冻结；旧字节/旧 mode/UID/GID/link、差异分类、profile old state、root Git closure 和恢复载荷需要新鲜真实 inventory 后生成，不能伪造。当前工具 snapshot 尚未在 main，现有 installer 的 tool→main ancestry 准入仍成立且会拒绝未合入工具。正常 PR 合入是后续安装输入，不能绕过此断言。

## 最小执行路径

| 步 | 当前完成 | 实际执行前仍需 | 执行到哪里 |
|---|---|---|---|
| 1 freeze | exact APP/BASE/release 与 source/target/hash 闭包已核；manifest/tag expected main-cn 绑定及本地测试已实现 | Mac 只读核现存 tag/main-cn、主机 inventory，明确 exact工具 main ancestry | 冻结 review 数据，不移动 production refs |
| 2 precheck/install | review producer、precheck、事务安装/恢复已有源码及本地负例 | 新鲜 62 项 inventory+provider receipt，exact安装diff及旧字节备份、profile proposal、root私有工具 checkout；用户确认下列动作 | 只更新批准的工具及 binding/profile；不安装应用、不重启服务 |
| 3 artifact build | trusted `--build-only` 选择 `artifact-build`；prepare→collector→verifier→publisher failclosed；owned child TERM/INT/EXIT join 已验证 | 合法 artifact-only admission、固定镜像 digest、root Docker已有认证、registry/AGE来源可达、主机资源实测 | build/push六镜像 slots、digest readback、immutable manifest/seal；prepared=false/activated=false/ready=false |

Step3 必须从现有可信 `workspacex-cn-build-candidate --build-only` 入口执行，不直接绕过其 gate 调 publisher。四个应用加 AGE postgres 为实际 build/push，redis 为已审 digest；六槽均需最终 registry readback。失败/中断不产生成功 seal，重试仅复用经 revision/digest 检验的既有不可变制品；不删除仓库或移动生产引用。

## 待批准动作（须先补齐 exact diff 才能执行）

1. **目标主机**：现有证据目标 `cn-shanghai / i-uf6ga92ewloganobbln6`。由原 Mac 只读确认 instance/provider terminal receipt、host identity、CPU/RAM/disk/cache、Docker/buildx/node/pnpm/git、runner identity、root Docker认证只验证存在不输出凭据。云端无通道，不复制凭据。旧 2026-10-04 01:01Z inventory 不满足安装一小时 freshness。
2. **固定工具安装**：批准精确 56 个 installed targets（列表见 source closure）及 6 个 source-only 文件进入 `/opt/workspacex-cn/release-tools/<exact-tool-sha>`。目标工具 mode 0700，source-only 0600，root:root；旧文件逐项 CAS；不改应用 checkout、Compose、网络、防火墙、数据库、业务容器。完整新旧 hash/mode/UID/GID/link diff 当前等待新鲜 inventory，尚不可批准为已完成 diff。
3. **binding/profile**：批准 generator 输出的 exact `/etc/workspacex-cn/trusted-tool-binding.json` proposal 内容/hash；消费 exact tool revision、installed closure 和实际 node runtime。现有 profile 若非 absent 则 create-only protocol 拒绝，需要独立审阅更新方案，不能直接覆盖。provider candidate read-only profile 是 4–7 输入，不将其添加为前3 build 前置或静默扩大权限。
4. **备份/恢复**：已有事务在 `/var/lib/workspacex-cn/trusted-install-backups/exact-*` root:root 0700，保存旧字节/metadata、manifest-binding、持久化 journal；FD9 现有锁下安装。失败自动按 exact reviewed CAS 恢复，备份所有结果保留。人工恢复只用 `--recover-reviewed`、exact manifest/hash、backup admission/hash，不用自由路径或临时脚本。必须在批准前拿到实际 backup/journal 路径和对应 hash；恢复失败保留现场及诊断，不继续 build。
5. **ACR**：现有历史 prefix 为 `workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com/workspacex-prod`。是否复用或新建 namespace/repository 仍需明确；不得凭历史缓存推断权限。批准范围仅固定9b的 `web/api/deep-agent/skill-sandbox/postgres-age` immutable tags及六槽digest readback；若需要新仓，先列 exact实例/namespace/repo、private可见性、费用及最小pull/push权限，单独批准，不执行 IAM 扩权或删除。
6. **Apache AGE**：固定 APP Dockerfile 将 AGE commit 固定为 `2db2f060c4c9265a14d40f007eb8c56febf31e4c`，base须已审pgvector digest。默认来源 `https://github.com/apache/age.git`；若现场不可达，需要 exact HTTPS 私有 Git mirror/repo URL，只导入该 commit 的可验证源码并保持 commit 不变。新私仓名称/可见性/访问及费用尚未给定，不能自行创建或外发凭据；不得发布 bare pgvector 代替 AGE postgres。
7. **构建操作**：在以上准入满足后确认 root build/push/seal 的允许时间窗和固定环境变量值；只制品发布，不生产SQL、不迁移、不 production prepare、不 activation。不将本次源码授权推断为 root安装或新仓授权。

## 耗时与剩余事实

Step1 1–3m、step2只读precheck2–5m（首次工具安装另计10–30m）、step3暖缓存预算12–28m，冷缓存35–75m+；均为条件预算，非实测保证。publisher 两波 `max(API,WEB)+max(agent,sandbox,AGE postgres)+seal`，每波≤12m且seal≤4m时约28m。原历史磁盘15.1GiB仅交接事实，需新的CPU/RAM/disk/cache/layer吞吐才能承诺≤30m。现场尚未执行 build，不能把本地mock毫秒作为生产耗时。

前3实际安装/构建仍未发生；当前没有新的 host/provider receipt、exact旧文件diff、真实registry auth/readback或固定四基础镜像digest。这些是具体准入输入，与暂停baseline255 replay及未完成A-route源码独立。
