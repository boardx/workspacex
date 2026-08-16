# `createProject` 蓝本错误码缺口 contract delta（#991 BP-08 前置）

本文件描述**契约面的一处变更**。`design-signoff.md` 是签核件，本文件是它的依据材料。

---

## 背景：BP-08（createProject 真执行六类初始化）动手前发现的结构性缺口

`#991` 裁决①（2026-08-12，人类批准）已经定了「project creation has two entry points」
问题的解法：**createProject 单门**，不实现 `templates.applyBlueprint` 的 HTTP 路由。
`create-project.ts` 目前对 `blueprintVersionId` 的处理是**原样落库、跳过六类初始化**——
BP-08 要把这一步补上：`createProject` 真正调用六类初始化写入。

补上真执行时撞上一个此前没人量过的缺口：**`project.createProject.err` 里没有任何蓝本相关
错误码**，而 `templates.applyBlueprint.err` 全都有：

| 契约操作 | err 集合 |
|---|---|
| `project.createProject`（今天） | `ORG_ROLE_INSUFFICIENT`, `INVALID_KIND`, `AUTH_SERVICE_UNAVAILABLE` |
| `templates.applyBlueprint`（已签核，从未接线） | 含 `BLUEPRINT_NOT_FOUND` / `BLUEPRINT_NOT_VISIBLE` / `BLUEPRINT_NOT_PUBLISHED` / `BLUEPRINT_VERSION_ARCHIVED` / `INITIALIZATION_FAILED` 等 |

`create-project.ts` 自己的头注已经点出这个洞：「不为『蓝本无效』造码……创建时蓝本不合法的
判据仍无出处」——当时（F117/#991 裁①之前）这是刻意留白，因为 `blueprintVersionId` 只是
原样落库，从不产生任何需要判断"这个蓝本合不合法"的分支。BP-08 把「原样落库」换成「真的用它
初始化」之后，这个分支第一次变得**必须存在**：调用方传了一个不存在/不可见/未发布/版本已归档
的 `blueprintVersionId`，`createProject` 需要一个能诚实报告"为什么没做"的码，而不是
（a）静默退化成空白项目，或（b）抛一个契约里没声明的码让响应体撒谎。

## 变更：`project.createProject.err` 新增五个码（同码同义，非新造）

```ts
createProject: {
  // ... method/path/in/out 不变 ...
  err: [
    "ORG_ROLE_INSUFFICIENT",
    "INVALID_KIND",
    "AUTH_SERVICE_UNAVAILABLE",
    // ⚠ 新增，全部与 templates.TemplateError 同码同义（同本文件 ProjectReason 既有的
    //   「① identity 束同码同义」「② artifact 束同码同义」两节是同一种做法，非首次）：
    "BLUEPRINT_NOT_FOUND",
    "BLUEPRINT_NOT_VISIBLE",
    "BLUEPRINT_NOT_PUBLISHED",
    "BLUEPRINT_VERSION_ARCHIVED",
    "INITIALIZATION_FAILED",
  ] as const,
}
```

`ProjectReason` 枚举同步新增这五个成员，归在新一节「④ templates 束同码同义」（紧跟既有的
①②③ 三节），逐条写清楚语义与 `templates.TemplateError` 对应成员完全一致：

| 码 | 语义（与 `templates.TemplateError` 逐字同义） |
|---|---|
| `BLUEPRINT_NOT_FOUND` | 传入的 `blueprintVersionId` 解析不到蓝本，**或**该蓝本对调用者越权可见——两者不可区分，不泄露资源存在性（与 `templates` 束同一条纪律） |
| `BLUEPRINT_NOT_VISIBLE` | 解析到蓝本，但是 team-only 且调用者不在该 team |
| `BLUEPRINT_NOT_PUBLISHED` | 蓝本存在但从未发布过任何版本（`resolvedVersion === null`） |
| `BLUEPRINT_VERSION_ARCHIVED` | 传入的版本已被归档，且这是一次**新增绑定**（I-7：存量实例化不受此拒，本码只挡"拿一个归档版本去建新项目"） |
| `INITIALIZATION_FAILED` | 六类写入部分失败（已整体回滚）。detail 须指明失败的类别名（同 `templates.applyBlueprint` 既有纪律） |

### 为什么是"同码同义"而不是各自造一套 `PROJECT_BLUEPRINT_*` 前缀

本文件顶部已有先例：`NO_PROJECT_ROLE`/`ADMIN_NOT_SUPERUSER` 等标注为「与 identity/artifact
束同码同义」，字面量在两个契约文件里各出现一次，但语义由其中一处（源头）定义、另一处引用同一份
判断依据，不是分别发明。蓝本相关的五个码语义已经在 `templates` 束（2026-07-30 原始签核）钉死，
`project` 束只是**在自己的错误面里承认"我也会产生这个结局"**，不是重新定义它们的含义——
造一套新前缀反而会制造出"这两个错误码含义有没有差异"的疑问，字面复用没有这个问题。

### 明确不做的事（范围边界）

- **不新增 `role` 相关码**：createProject 的角色门槛维持 `ORG_ROLE_INSUFFICIENT`
  （lead-or-admin，#608），不为"套用蓝本"单独造一个角色判断或错误码——已投查明的结论是
  `templates.applyBlueprint` 自己的 `canApplyBlueprint`（lead-only）治理的是一条从未接线、
  且本次也不会被接线的路径（`applyBlueprintUseCase` 整体不会被 BP-08 调用），因此它的角色
  门槛不进入本 delta 的范围，`createProject` 现有的 `ORG_ROLE_INSUFFICIENT` 判断本身不需要
  任何改动。
- **不改 `createProject.in`/`out` 的形状**：`blueprintVersionId` 参数已存在（F117 签核），
  返回体 `id`/`kind`/`status`/`provenanceEventId` 不变。
- **不解决 `TIER_CHANGE_NEEDS_CONFIRMATION`/`CUSTOM_TIER_RULE_UNDEFINED` 等换档位相关码**：
  #991 裁① 已定"项目继承蓝本版本快照里的档位，本版不做覆盖"，创建时不存在"改档位"这个动作，
  这两个码不适用于 `createProject`。
- **不动 `applyBlueprint` 契约本身**：它保留在 `templates` 束原样，仅未来若要真正接线才需要
  另一轮评审（本 delta 不预支那个决定）。
