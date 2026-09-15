# 12 个稳定密钥的跨版本连续性

## 结论

`runtime-environment.ts` 当前需要 12 个内部生成密钥：

`model-cipher`、`email-verification`、`native-binding`、`service-key`、`admin-password`、`app-password`、`owner-password`、`diag-password`、`redis-password`、`agent-password`、`memory-password`、`memory-owner-password`。

现有 `ensureDeploymentSecret` 只保证同一目录内的并发调用收敛到旧值。`runtimeEnvironment` 接收的 `secretDirectory` 来自 release 的 `runtimeDirectory/secrets` 时，新 revision 会得到一个新目录，因此没有跨版本连续性证明。常规发布必须在写 runtime bundle 之前对此 fail-closed。

这 12 个密钥是环境身份：应用回滚或升级都继续使用同一组值。版本 manifest 只引用稳定目录的身份/receipt，不复制密钥值。

## 只读 preflight

preflight 由持有 release lock 的控制器运行，禁止调用 `ensureDeploymentSecret` 或 `runtimeEnvironment`，因为两者可能创建目录/密钥。它只读取当前生产 baseline 的稳定密钥目录、候选配置和消费者映射。

1. 从正在运行的 baseline compose/runtime receipt 解析实际稳定目录；从候选配置解析将使用的目录。两者必须是同一 canonical path，路径中不得含 source SHA、release 名或 attempt ID。
2. 目录必须为 root 私有普通目录、非 symlink、mode 0700；12 个条目必须是 root 私有 regular file、非 symlink、mode 0600，长度与格式满足生成器契约。
3. required key 集合从代码导出的 `stableDeploymentSecretNames` 读取；发布脚本和 Skill 不再维护第二份运行时数组。preflight 断言集合数量为 12，防止新增消费者却漏进门控。
4. 在单一进程内逐项 constant-time 比较 baseline 值与候选将读取的值。公开结果只写 `matchedCount`、`missingKeyIds`、`rotatedKeyIds` 和布尔值，不写 secret、hash、文件内容、inode 或路径。
5. 静态解析 API/Agent/Bootstrap/Starter dependency 的消费者映射，确保每个 key 仍投影到既有语义。重命名、互换消费者或少一个消费者返回 `STABLE_SECRET_CONSUMER_DRIFT`。
6. 检查前后对目录树做脱敏 metadata 快照；mtime/inode/entry count 不得变化，结果写 `noMutation=true`。任何读取或比较不能证明都阻塞。

建议的生产路径是 `/var/lib/workspacex-cn/stable-secrets`，但路径本身应来自一处受保护配置。preflight 不在输出中公开该路径。

## failure code

| code | 含义 | 脱敏 evidence |
|---|---|---|
| `STABLE_SECRET_DIRECTORY_VERSION_SCOPED` | 候选目录随 SHA/release/attempt 改变 | `stableDirectory=false` |
| `STABLE_SECRET_SET_MISMATCH` | 代码声明的 key 集合不是预期的完整集合 | required/observed count、key ID |
| `STABLE_SECRET_MISSING` | baseline 或候选缺条目 | `missingKeyIds` |
| `STABLE_SECRET_ROTATION_DETECTED` | 同一 key 的候选值与 baseline 不同 | `rotatedKeyIds` |
| `STABLE_SECRET_UNSAFE_PATH` | 目录/文件 ownership、mode、类型或 symlink 不安全 | key ID、固定规则 ID |
| `STABLE_SECRET_READ_UNPROVEN` | 无法完整读取并比较 | key ID、correlation ID |
| `STABLE_SECRET_CONSUMER_DRIFT` | key 到环境消费者的映射变化 | `consumerDriftIds` |
| `STABLE_SECRET_CONTINUITY_UNKNOWN` | 未分类异常 | correlation ID |

未知错误和无法读取都阻塞。failure record 禁止携带 `value`、`hash`、`contents`、`path`、env map、异常 message 或命令 stderr。

## 修复步骤

发现当前环境仍使用 revision-scoped secrets 时，在不切流的维护动作中修复：

1. 保持当前生产版本运行并取得 release lock；记录 baseline runtime、容器 digest 和浏览器健康证据。
2. 把当前**正在运行版本实际使用**的 12 个值视为唯一 baseline。创建 root 0700 staging 目录，逐项以 0600 复制，验证数量、格式和内存 equality，fsync 文件和目录后原子 rename 为稳定目录。不得调用生成器补缺；缺任一项立即停止。
3. 修改 runtime bundle 的单一配置，使所有版本只引用稳定目录；生成器仅允许全新环境第一次初始化，已上线环境缺项必须 fail-closed。
4. 先运行本只读 preflight，再在无流量 prepare 中生成候选 env files；逐项证明候选读取同一值，然后才允许 activation。
5. 修复 receipt 记录 stable directory identity、required count、matched count 和 evidence hash，不记录密钥值或裸 hash。

若 baseline 已出现两组值，不能凭文件时间猜测。以正在运行容器实际使用且能通过登录、解密、内部认证和数据服务探针的一组为准；不能证明时停止并进入人工恢复。

## 回滚步骤

常规应用回滚只恢复旧镜像、Compose/Nginx 指针，**不回滚、不轮换稳定密钥目录**。回滚后用同一稳定目录验证：管理员登录、已有模型凭据解密、邮箱 token 签名兼容、API↔Agent/native binding、数据库/Redis/Agent memory 连接。

若错误 activation 已指向新生成密钥：立即拒绝新写流量，恢复 baseline 对稳定目录的引用，恢复旧镜像/指针，运行上述探针和浏览器验收。新生成目录先 root-only quarantine，待确认没有生产写入依赖后再按独立清理流程处理；不得在发布脚本中自动删除。

真正轮换任一稳定密钥必须走独立 maintenance lane：列出受影响数据、双读/双签或重加密计划、回退密钥和用户会话影响。不得借普通版本发布顺带轮换。

## 反证测试

实现 preflight 时至少覆盖：

1. 候选路径包含另一个 source SHA，返回 `STABLE_SECRET_DIRECTORY_VERSION_SCOPED`；
2. 删除任一条目，返回 `STABLE_SECRET_MISSING`；
3. 只改变一个值，返回 `STABLE_SECRET_ROTATION_DETECTED`；
4. 交换 `service-key` 与 `native-binding` 的消费者，返回 `STABLE_SECRET_CONSUMER_DRIFT`；
5. 文件变为 symlink 或 mode 0644，返回 `STABLE_SECRET_UNSAFE_PATH`；
6. preflight 前后 metadata 变化，`noMutation` 不能为 true；
7. failure metadata 加入 `value`、`hash` 或 `path`，聚合 validator 必须拒绝；
8. 全部 12 项复用时 `ready=true`、`matchedCount=12`、`noMutation=true`。
