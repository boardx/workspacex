---
name: verification-writer
description: >
  激活条件：用户提到 写验证、验证命令、断言、怎么测、verification、端到端验证、
  防假阳性、验收命令 等关键词时触发。
  产出可执行的端到端验证命令，作为实现前就定下的「完成契约」。
---

# Verification Writer Skill

## 何时使用

要为一个 feature 写 `verification` 命令时。**这一步发生在写实现代码之前**——
verification 是生成者和评审者共同认可的「完成契约」，先定契约再动手。

> 端到端验证标准见 [testing-standards.md](.harness/instructions/testing-standards.md)。
> 本 skill 提供命令库与防假阳性手法。

---

## 能力清单（这个 skill 让你具体能做什么）

- 把 `user_visible_behavior` 转译成一条或多条可执行、退出码语义正确的 shell 断言。
- 按出口类型（HTTP/CLI/文件/日志/状态转移/证据入库）从命令库里选对模板，
  优先选「离用户可观察出口最近」的那层（见下方领域知识①）。
- 对每条命令做「变异检查」：故意把期望值改错、故意制造失败路径，确认命令
  真的会变红，而不是语法上能跑但断言恒真（见下方领域知识②）。
- 识别迁移类（L4）、契约缺口（L10）等专项场景，套用对应的加固写法。
- 判断哪些证据必须额外补一条「证据已入库」断言（L1），防止 evidence 指向空气。
- 识别一条 verification 是否可能在 CI/干净环境里失败（依赖本地服务已启动等），
  提前加 setup 步骤或拆成独立命令。

---

## 架构知识：这一环在全链路里的位置

```
requirement-author（spec_ref + 草稿 user_visible_behavior）
feature-writing（字段规范 + 反模式约束）
        │
        ▼
[verification-writer]（你）── verification 数组 = 完成契约 ──┐
        │                                                    │
        ▼                                                    ▼
feature-implementer（把契约当实现边界，动手前重跑一遍确认仍是红的）
        │
        ▼
pnpm harness verify（真正执行这批命令，落 evidence，门控 status → passing）
        │
        ▼
rev-feature / rev-e2e（复核证据真实性，不只信任 exit code，会实测复现）
harness doctor（合并后审计整条证据链，ADR-012）
```

- **上游**：`user_visible_behavior`（要证明什么）+ `spec_ref`（这行为出自哪条
  需求）。verification-writer 不重新发明行为描述，只负责把它变成可执行断言。
- **下游**：feature-implementer 把这批命令当「完成边界」；`pnpm harness verify`
  是唯一能把 status 推进到 `passing` 的执行者；`rev-feature`/`rev-e2e` 会实测
  复现（不只信任 exit code）；`harness doctor` 在合并后再核一遍证据真实性
  （evidence 是否真的在 git 树里、是否非空）。
- **机械门控重新校验点**：`pnpm harness verify` 的退出码判定、L1 的证据入库断言
  （`git cat-file -e`）、`doctor` 的审计链体检。你写的命令质量直接决定这几层
  门控是「真的在挡东西」还是「形同虚设地全绿」。

---

## 领域/商业知识：为什么这样设计

**①出口分级为什么优先高层（呼应 Testing Trophy）**：Kent C. Dodds 提出的
Testing Trophy 思想认为集成/端到端层的断言 ROI 最高——它验证的是用户真正
关心的行为，而不是实现细节；过度依赖底层单元断言或「文件存在」类检查，
在重构后容易产生假阳性（代码变了但检查项没跟上）或假阴性（行为坏了但检查项
没覆盖到）。本仓命令库把 HTTP/行为输出断言排最优先，文件存在检查排最低，
正是同一逻辑落地——feature-writing skill 的分级表与本 skill 共享同一套依据，
不重复定义规则本身，只是站在不同环节各自应用。

**②「先手动跑一遍并故意制造失败」= 对契约做一次人工 mutation testing**：
mutation testing 的核心思路是「故意在被测代码里注入一个小变异（改一个运算符、
改一个返回值），看测试是否变红——如果测试仍然是绿的，说明这条测试根本没有
在测什么」。本仓要求「写完命令后先故意制造失败」正是同一手法的人工版本，
只是变异对象从「代码」换成了「期望值」：把 `jq -e '.ok == true'` 里的
`true` 改成 `false` 观察命令是否真的报错退出，或者把 `grep -q 'expected'`
的模式串改成一个必然不存在的字符串，确认退出码真的翻到非 0——比只跑一次
「正常应该会过」的路径更能发现「语法能跑但断言恒真」的隐患（最常见的真实
诱因是命令被塞进 `cmd1 | cmd2` 管道后，只有 `cmd2` 的退出码被检查，
`cmd1` 真实失败却被吞掉；或断言表达式本身写错、恒为真但没人发现，因为
从没让它跑过失败路径）。写完一条命令，至少对它的核心断言值做一次这样的
「变异 - 观察是否变红」检查。

**③专项要求为什么存在（真实事故驱动，不是假设）**：L1（evidence 未入库三连
事故 PR #310/#311/#312）、L4（迁移类断言用了会误伤同名数据的自然键，
PR #312）都是本仓真实发生过的返工，不是预防性想象出来的规则。这与
`contract-design.md` 里 B-8「响应体也要被契约校验」的教训同构——都是
「表面上门控全绿，但门控没有真的在检查它应该检查的东西」，唯一的解法是
把「这条门控本身是否有效」也变成一个可验证的动作（变异检查/反向断言），
而不是只信任门控存在这件事本身。

---

---

## 一条合格的 verification 命令

必须满足：
1. **可执行**：复制粘贴就能跑，退出码 0 = 通过、非 0 = 失败。
2. **断言真实出口**：检查 `user_visible_behavior` 描述的可观察结果，不是「跑起来不报错」。
3. **可复现**：在干净环境重跑结果一致，不依赖一次性手工状态。

---

## 命令库（按出口类型）

| 出口 | 模板 |
|------|------|
| HTTP JSON | `curl -sf localhost:3000/api/x \| jq -e '.field == "expected"'` |
| HTTP 状态码 | `test "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/x)" = "200"` |
| CLI 退出码 | `pnpm harness verify --sprint 01/01 --feature F01` |
| 文件产物 | `test -f dist/out.js && grep -q 'expected' dist/out.js` |
| 日志行 | `grep -q 'server listening' evidence/F01.run.log` |
| 状态转移 | `jq -e '.features[] \| select(.id=="F01") \| .status=="passing"' phases/.../feature_list.json` |
| 证据已入库（L1） | `git cat-file -e HEAD:phases/<phase>/evidence/F01.verify.log` |

**证据入库断言（L1 三连事故的固化）**：verification 数组里应包含一条断言证据文件
真实在 git 树中（如上 `git cat-file -e HEAD:...`），防止 evidence 被 `.gitignore`
挡住变成「指向空气的引用」而无人发现。

---

## 防假阳性（最容易翻车的地方）

> 这些坑直接对应 harness-workflow 里沉淀的「verify:base 空跑成功」教训。

- ❌ `echo TODO && exit 0` —— 占位命令永远绿，等于没验证。
- ❌ `curl localhost:3000/x` 不带 `-f` —— 服务 500 也返回退出码 0。用 `curl -sf`。
- ❌ `grep foo` 不带 `-q` 且不检查退出码 —— 没匹配到也可能被忽略。
- ❌ 断言「不报错」而非断言「正确输出」—— 改用 `jq -e` 断言具体值。
- ✅ 每条命令写完后，**先手动跑一遍并故意制造失败**，确认它真的会变红。

---

## 专项要求

**迁移类 feature（L4，PR #312 事故）**：verification 必须包含 DB 级**全库不变量断言**
（如 `psql -c "select count(*) from ... where <违反不变量>"` 断言 count=0），
且该命令的**原始输出必须留在 evidence 里**。回填/变更目标的判据禁止用 name/自然键
（会误伤用户同名数据），必须用专用标记列（如 `created_by_migration`）。

**契约缺口显式归属（L10）**：`user_visible_behavior` 里暂时无法在本 feature 断言的行，
必须在 notes/spec 注释中写明「由 FXX 交付时断言」，禁止静默跳过。

---

## 产出后

把命令写进 feature 的 `verification` 数组（feature_list.json）。
真正的门控由 `pnpm harness verify` 执行——它跑这些命令、落证据到 `evidence/`、
全绿才把 feature 升 `passing`（不可逆）。需要起服务走活体路径时，交给
**e2e-verifier** subagent。绝不手改 status。

---

## 迭代/进化机制：这个 skill 本身怎么变好

- **专项要求是 append-only 的事故沉淀点**：L1/L4/L10 都是真实事故换来的规则，
  格式固定为 `**<场景类别>（L<编号>，<出处>）**：<加固写法>`。新事故出现时
  照此格式追加一条，不要覆盖或删除旧条目——旧场景不会因为写了新规则就不再
  发生。
- **命令库随技术栈演化**：出口类型模板（HTTP/CLI/文件/日志…）如果本仓引入新的
  可观察出口类型（如消息队列、WebSocket 推送），在命令库表里补一行模板，
  并说明它在分级表里应该排第几优先级（按「离用户可观察结果多近」判断，
  不是按实现难度）。
- **变异检查手法的校准**：「故意制造失败」目前是人工执行的、非强制的建议动作；
  如果未来本仓接入自动化 mutation testing 工具，本节的手工检查清单应该收敛为
  「工具输出的复核清单」而不是并存两套互相不知道对方存在的检查方式——出现
  第二份重复的检查逻辑时，参照 AGENTS.md「同一事实不得声明在两处」收敛掉。

<空，升级开始后追加>

