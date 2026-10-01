# V2 作者化产出约定

> 补 `AUTHORING-PROTOCOL.md` 没写的「产出放哪、评审长什么样、进度从哪读」（#4534）。
> 机械门控：`pnpm run lint:work-stack-graph`（`.harness/scripts/lint-work-stack-graph.mjs`）。

## 产出路径
| 实体 | 文档 | 评审 |
|---|---|---|
| Skill | `skills/<ID>-<slug>.md`（如 `skills/S003-enterprise-search.md`） | `reviews/<ID>.review.md` |
| Workflow | `workflows/<ID>-<slug>.md` | `reviews/<ID>.review.md` |
| DigitalHuman | `digital-humans/<ID>-<slug>.md` | `reviews/<ID>.review.md` |

- `<ID>` 必须是 `AUTHORING-TASK-MANIFEST.json` 里的实体；一个 ID 只有一份文档。
- 已作者化的 Skill 必须在两张组合矩阵上至少有一个 Workflow 或 DigitalHuman 消费者。
  图上没有消费者的 Skill，先修订矩阵（加消费者 / MERGE / DELETE），再作者化。
- 作者化过程中发现组合图要改（缺 Skill、Skill 过宽、边不对），**改矩阵本身**，并在评审里写明；
  不在实体文档里另写一份组合关系。

## 评审文件格式
第一行非空内容必须是 `Verdict: <PASS | REWRITE | SPLIT | MERGE | DELETE>`，随后六节，对应协议的「Required reviewer verdict」：

```
Verdict: PASS
## Composition correctness
## Professional depth
## Provenance / license
## WorkspaceX architecture fit
## Eval completeness
## Unresolved questions
```

评审者只看实体文档、它在矩阵上的边和引用的证据，不看作者的推理过程。

## 进度
进度只从 `reviews/` 目录派生，不另存状态：

```bash
pnpm run lint:work-stack-graph -- --summary
```
