# 导出一个组织的全部数据（退出自由）

WorkSpaceX 承诺：**你的数据随时可以用开放格式整体带走**（开源方案 D11「退出自由」）。
这条承诺对应的是一条真实命令，不是一句话；登记在方案的「承诺与门控对照表」里，由
`lint-commitments` 核对命令是否存在。

## 用法

在能连上数据库的机器上（使用与迁移相同的 `PG*` 环境变量 / `migrationConfig()`）：

```bash
pnpm --filter api run export:org -- --org=<organizations.id> --out=/backup/acme-export --tar
```

- `--org` 必填：只导出这一个组织。没有「导出全部组织」的默认值。
- `--out` 必填：输出目录，必须不存在或为空（不会覆盖）。
- `--tar` 可选：额外生成 `<out>.tar.gz`。

命令只读（`REPEATABLE READ READ ONLY` 事务，数据一致的快照），可重复执行。

## 输出

| 文件 | 内容 |
|---|---|
| `manifest.json` | 导出的每张表及行数；**跳过的每张表及原因**；汇总 |
| `tables/<表名>.ndjson` | 每行一个 JSON 对象；二进制列写成 `{"$base64": "..."}`，时间为 ISO 8601 |
| `files.ndjson` | 该组织所有文件在对象存储中的键（`object_storage_key`），按此清单从对象存储取回字节 |

## 导出范围怎么决定

表不是手写清单，而是运行时从 `information_schema` 发现的：

- `organizations` 按 `id` 导出该组织那一行；
- 凡是有 `org_id` 列的表，导出 `org_id = <你的组织>` 的行；
- 其余的表（全局表、共享目录、只能经父表归属的子表、迁移账本）**不导出，但逐张写进
  `manifest.json` 的 `skipped`，附原因**。

隔离有两层：每条查询都带 `org_id` 过滤，同时事务内把 `app.current_org` 设为目标组织，
行级安全策略（RLS）也只放行该组织的行。

## 已知边界

- 文件**字节**在对象存储里，本命令只给出完整键清单，不拷贝字节。
- 没有 `org_id` 列的子表（例如只挂在父表外键下的明细表）目前列在 `skipped` 里；
  需要时应给这些表补 `org_id` 列，导出会自动纳入，无需改本命令。
- 目前没有对应的「导入」命令。
