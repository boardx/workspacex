# HMV2-002 — 全仓模板 inventory（含隐形模板）

> Epic E0（决策与安全基线）交付物。范围：找出**已经在仓库里重复出现、但没有被
> `TPL-*` 注册表收录**的结构化形状（"隐形模板"）。方法见文末「怎么做的」。
>
> **这不是要把每一个重复出现的东西都塞进 TPL 注册表。** E1 的 `InstanceMetadata`
> schema 目前只扫描**独立文件**（`.yaml`/`.yml`/`.md`，从 frontmatter 或整份内容
> 取 `template_id`/`instance_id`）——这个模型天然覆盖不了"嵌在别的文件内部的一段
> 重复结构"（比如一个函数头部的注释小节）或"根本不是文件的东西"（PR 正文、
GitHub 评论）。硬把这类候选注册成 TPL 类型，会重演 #641 反复强调过的教训：
> **先看形状合不合适，合适才收编，不合适就如实记录"现在的模型盖不到"，不要
> 削足适履**。所以下面把 8 个候选先分成两类，只有第一类真的走注册。

## 分类 A：文件级、能直接套 InstanceMetadata schema —— 已注册

| 新分配 ID | 名字 | 覆盖 | 实测数量 |
|---|---|---|---|
| `TPL-SKL-001` | Skill Activation Metadata | 所有 `.agents/skills/*/SKILL.md` 的 frontmatter（`name` + `description` 里的「激活条件：用户提到…等关键词时触发」小节） | 17/18（除 `mod-_template` 脚手架本身） |
| `TPL-UIP-001` | UI Preview Index | `phases/<phase>/ui-preview/<bundle>/README.md`：引用块头（日期/路由数/门控状态）+ 截图清单表 | 21 |
| `TPL-DLT-001` | Design Delta Bundle | `phases/<phase>/design-deltas/<name>/{contract.md,verification.md,design-signoff.md}` 三文件一组 | 2（`realtime-asr`、`wave2-runtime`） |

**为什么这三个合适**：三者都是**独立文件**（或独立文件组），已经有稳定的重复
结构，且**没有**被现有 23 个类型里任何一个覆盖——`TPL-SKL-001` 与 `TPL-MOD-001`
（Module Knowledge）的区别是范围：`TPL-MOD-001` 管 `mod-*/SKILL.md` 的**内容体**
（模块活知识），`TPL-SKL-001` 管**所有** `SKILL.md`（含非 `mod-*` 的 17 个工作流/
角色 skill）的**激活元数据**（`description` 里那句「激活条件」）——两者管的是同一
份文件的不同关注面，不是重复登记。`TPL-DLT-001` 与已注册的 `TPL-CTR-001`
（Contract Bundle）区别是：Contract Bundle 是 5 件套（`domain.md`/`usecases.md`/
`coverage.md`/`ui.md`/`design-signoff.md`），Design Delta 是给**阶段中途、不走
整束重签**的小修订用的 3 件套，目前只有 2 个实例——趁它还只有 2 个、两次都独立
收敛到同一个形状时登记，好过等第三次有人发明变体。

三个类型已通过 `pnpm harness templates allocate` 写入 `.harness/templates/registry.yaml`
（占号即登记，同 ADR/Template ID 分配器的一致纪律，不是手改数组）。

## 分类 B：不是独立文件，或嵌在别的文件内部 —— 如实记录"现在的模型盖不到"，不注册

| 候选 | 实测规模 | 为什么不适合现在的 InstanceMetadata 模型 |
|---|---|---|
| 反证式测试用例（`it("反证…")`） | 187 个测试文件命中 | 是**测试文件内部的一个 case**，不是独立文件；那个 `.test.ts` 文件本身已经有自己的身份（属于被测的那个 domain），不该也不能同时是一份模板实例 |
| PR/commit 正文的"反证证据"写法（基线绿→注入违规→确认红→恢复→确认绿） | 29 条 commit body 命中 `^反证：` | 不是文件，是 git 对象/GitHub 数据——E1 的扫描器只认仓库里的 `.yaml`/`.md` 文件 |
| Lint 门控脚本的头部结构（"管的是什么"/"为什么必须存在"/"判定N条"） | 8 个 `lint-*.mjs`/`lib/*.ts` 中的 5 个 | 是**源码文件的一段注释**，文件本身的身份是"一个门控脚本"，不该双重注册 |
| Application/接口层文件的 `## 为什么…` 设计动机注释块 | 99 个文件命中 | 同上：源码文件内部的一个注释小节，不是独立制品 |
| GitHub issue 状态汇报评论（粗体身份前缀 + 叙事 + "我做不到的部分"收尾） | 24 个 issue 命中 | 不是文件，是 GitHub 评论；且这类评论本身**不该**被强行模板化——过度格式化会让"如实汇报进展"变成"填表"，价值反而降低 |

**这五类不是"发现了但没空做"，是"这次评估后判定：现在的文件级扫描模型不该
覆盖它们"**。如果未来真的需要治理其中某一类（比如反证测试用例的覆盖率），
正确的路径是 Epic E2/E7 的方向——写一个**读源码 AST 的 lint**（同
`lint-verification-can-fail.mjs`/`lint-third-artifact.mjs` 的路子），而不是把
它们塞进 E1 的文件实例扫描器。这条判断本身也是 HMV2-002 的交付物之一：明确
"模板"这个词在 E1 里指什么、不指什么，防止后面每个人各自理解一遍。

## 怎么做的

一个 subagent 广度优先扫描，输入是 Proposal §8 的 23 个已注册类型（作为排除
清单）+ 若干候选方向的种子提示；每个候选要求至少 2 个真实实例（含具体文件路径）
才计入，少于 2 个的（如仅 1 例的 `DEBT-*.md` 债务登记文档）直接丢弃，不列入
本文档——"扫到不算数的东西"本身也是一种噪音，不比"没扫到"更好。

## 后续（HMV2-003/004，未在本文档做）

- HMV2-004（为现有模板分配永久编号）：分类 A 的三个已经在做这件事本身完成了
  （分配 ID = 本文档这一步）；分类 B 不适用（不是要注册的对象）。
- HMV2-003（冻结旧模板新增入口，WARN 不阻断）：留给下一个 PR——需要先决定
  "新增入口"对分类 A 三个类型具体指什么可判定的事件（比如新增一个不带
  `template_id` frontmatter 的 `ui-preview/README.md`），这是一段独立的门控
  设计工作，不适合塞进这次的 inventory PR 里一起做完。
