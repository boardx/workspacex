# 四轮 CI，四个本地发现不了的真问题

> 2026-09-15。PR #3699 推上去之后连红四轮，**没有一条是 flake**。
> 这份记录写下来是因为：四个问题里有三个，在我本地的 tsc / eslint / 单元测试下**全绿**。
> 它们共同指向同一件事——评分卡里那句「静态痕迹 ≠ 动态事实」不是一句格言，是账单。

## 四轮

| 轮 | 红的检查 | 真因 | 本地为什么发现不了 |
|---|---|---|---|
| 1 | `gates-fast` | 租户表读取未经 `permission-filter`，仓储交出裸行 | **我不知道有这道门**。它不在我跑过的任何一条命令里 |
| 2 | `gates-test` ×4、`verify-affected`、`fullstack-smoke`、`e2e-core-loop` … | 迁移 `REFERENCES threads(id)`（表叫 `chat_threads`）+ `thread_id`/`org_id` 写成 `uuid`（本仓是 `text`） | 这台机器没有 Docker，**跑不到迁移** |
| 3 | `gates-runtime` | 四张新租户表**没有 RLS 策略** | 同上 |
| 4 | `verify-affected` → `web#lint` | `lint-design` 12 处违规（硬编码颜色 / markdown 加粗 / 裸 `text-foreground`） | 我跑的是 `.harness/scripts/lint-design.sh`——**那个路径不存在** |

## 第 4 轮最值得记

前三个是"我不知道"或"这里跑不了"，第四个不是：**我以为我跑过了**。

我执行的命令报了 `No such file or directory`，我看了一眼就去跑下一条门了。
一条"没跑起来"的检查和一条"跑了并通过"的检查，在终端里差别只有一行——
而那一行我没读。

> ⚠ 跑一条检查之后，**先确认它真的跑了**（有输出、有扫描计数），再看它是不是绿的。
> 这个仓库里 `lint-arch-deps` 的头注为同一件事写过一整段：它曾经"对一个不存在的
> 目录打印 skipped 并 exit 0"，于是一条被描述成"强制"的门，实际上从未扫描过一个文件。

## 每个问题都补了「在任何机器上都能跑」的门控

补静态门控不是为了替代真跑一次，是为了让**下一次**不必等到 CI 才发现：

| 门控 | 挡住什么 | 反证 |
|---|---|---|
| 迁移里每个 `REFERENCES xxx(` 的表必须真被 `CREATE TABLE` 过 | 第 2 轮 | ⑫：还原成 `threads` ⇒ 红 |
| `thread_id` / `org_id` 必须是 `text` | 第 2 轮 | ⑫ |
| 契约里 `threadId` 不得是 `.uuid()` | 第 2 轮（会让请求全部 400） | ⑫ |
| 每个 `CREATE TABLE` 必须四件套齐全（ENABLE + FORCE + policy + GRANT） | 第 3 轮 | ⑬：漏一张表 ⇒ 红 |
| 审计表的 GRANT 里不得有 UPDATE / DELETE | 能被改写的记录不是证据 | ⑬ |

第 1 轮与第 4 轮不需要新门控——它们本来就有门，只是我没跑到：
`apps/api/scripts/lint-permission-paths.mjs`（`pnpm run lint` 里）与
`apps/web/scripts/lint-design.sh`（`pnpm run lint` 里）。
**教训是改跑法，不是加脚本**：推之前在两个 app 目录各跑一次 `pnpm run lint`。

## 这四轮如何印证了自评

评分卡终评 87/100，扣掉的 13 分里有 4 分是「迁移没在真库跑过、页面没在 devapp
打开过」。当时我写「这些不是少写了哪个函数，是这一层验证本轮确实没做」。

第 2、3 轮证明那 4 分扣得对：**那后面真的有东西**——一个跑不起来的迁移和四张
没有第一道防线的租户表。如果当时因为"代码看起来对"就把分给了自己，
这两个问题会一直藏到部署那天。
