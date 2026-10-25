# 交付验收与故障处理

## 首次验收（部署者逐项签实际结果）

| 验收项 | 如何验证 | 记录什么 |
|---|---|---|
| 安装包可信 | 独立渠道核对包 SHA256；包内 SHA256SUMS 全绿 | 包摘要、来源、时间 |
| 主机档位 | Ubuntu24.04/x86_64、Docker/Compose/systemd/AppArmor 功能检查 | 实测版本、存储路径、CPU/内存/磁盘预算 |
| 网络隔离 | 仅运维 SSH 与公网80/443；PG/Redis/API/Web无公网发布 | 防火墙和实际监听检查 |
| 数据持久化 | PG/Redis/objects 挂载到持久盘；重启后管理员和文件仍在 | 重启前后截图/文件 hash |
| HTTPS | 域名、链、有效期、续期和 nginx reload 通过 | 域名、到期时间和 renew 演练 |
| 业务 API | scripts/40-accept.sh 实际成功 | 脱敏输出；不上传 probe.env 或 token |
| 浏览器登录 | 在真实浏览器打开域名，以初始管理员登录 | 浏览器截图；不能只用 curl 代替 |
| 真实聊天 | 浏览器创建对话，模型真实返回、刷新后历史仍在 | 会话标识、模型与时间、脱敏截图 |
| 产物 | 上传文件，生成一份文件，点击下载并打开确认内容 | 文件 hash 和截图；只检查下载200不够 |
| Agent 与沙箱 | 实际任务走 Agent 和隔离沙箱 | 业务探针与可见执行结果 |
| 发布身份 | 读实际容器 image ID、OCI revision、release receipt | 完整源 SHA、tag、五个构建 digest与运行应用ID；初始 marker不作版本证明 |
| 备份离机 | 备份后复制至另一私密存储，核对 checksum | 存储位置、保留期、责任人 |
| 恢复演练 | 新替代机用prepare-restore/restore走完，浏览器再验 | 恢复耗时、恢复点、结果 |
| 手动发布 | main-us 更新后不部署，Run workflow才部署US | Actions链接、手动操作记录、US实际receipt |
| 失败恢复 | 隔离演练机引入受控坏候选，验证恢复旧应用和业务 | ROLLED_BACK非零退出、旧image ID、验收结果 |

默认不包含邮件/ASR/第三方连接器/受控浏览器的成功声明。需要这些能力必须各加一条真实验收。新环境从未测过失败恢复，不能向别人承诺已验证自动回滚可靠。

## 运行检查命令（US root）

```bash
docker compose -p workspacex-us --env-file /etc/workspacex-us/compose.env -f /etc/workspacex-us/compose.json ps
systemctl status nginx --no-pager
ls -l /etc/workspacex-image-release/us.json
```

发布后基线还叠加 current.json 指向的受信 override；**不要用原始 Compose 再执行 up -d**，那会退回初始镜像。日常更新只调用受信发布入口；观察容器/日志不等于变更基线。

## 常见失败与处理

| 现象 | 处理 |
|---|---|
| placeholder/invalid config | 改本机私密settings；未部署前重新生成；已部署不要重生成稳定密钥。 |
| 镜像401/拉不到 | 确认公网端点、只读账号、完整五镜像tag、Redis摘要和保留策略；不改成public仓库绕过。 |
| bootstrap失败且有started标记 | 保留现场。检查哪个DDL/角色/数据目录已经变更；未明确幂等边界不可删标记重跑。 |
| /healthz成功但登录/文件失败 | 检查真实业务探针、FS目录uid1000权限、原稳定密钥、模型接口；不能宣称部署成功。 |
| BUSINESS_VERIFICATION_FAILED | root私密运行business-probe检查；核对模型、外网DNS/TLS、测试账号和Agent状态。探针会花模型用量。 |
| US job一直排队 | Environment规则、Runner online/标签、仓库归属；不要改成CN/DevApp标签借机器。 |
| UNTRUSTED_HOST_PATH/INPUT_DRIFT | 核对root ownership、父目录权限、文件哈希；配置变更走独立审核与业务验收，不改hash强行放行。 |
| SQL/Memory清单差异 | 独立备份、向后兼容迁移、演练后再发布，不关掉schema校验。 |
| ROLLED_BACK | 仍算发布失败；核对旧应用与业务验收成功，再修候选。 |
| ROLLBACK_FAILED/pending.json残留 | 停止后续部署，保存intent/receipt，恢复Docker/主机、核对实际容器后由运维显式协调。不能直接rm pending放行。 |
| 锁忙 | 看真实systemd部署进程及receipt；不要删锁制造并发入口。 |
| Probe退出79/Agent状态不明 | 可能有未结束的远端运行。排查并确认清理后再继续，不能自动重试刷模型调用。 |

## 回退

相同schema且维护者确认兼容时，可手动发布已知成功旧tag，走相同验收。schema有变更时不能认为镜像回退撤销DDL；按恢复演练方案处理数据。脚本在停电、SIGKILL、Docker daemon丢失时不能证明自动恢复完成，必须对账。
