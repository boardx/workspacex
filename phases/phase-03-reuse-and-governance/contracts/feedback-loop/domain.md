# 契约束 `feedback-loop` — 领域模型

## 1. 实体

| 实体 | 表 | 生命周期 |
|---|---|---|
| 反馈 | `product_feedback` | 创建后本体不可改；只有 `status` / `status_reason` 两列可变 |
| 票 | `product_feedback_votes` | 可加可撤；主键 `(feedback_id, voter_id)` 即幂等键 |
| 状态事件 | `product_feedback_status_events` | append-only |

### 为什么票是**行**不是列

契约 I-F2。存一个 `vote_count` 列就是立刻多出第二份可能对不上的事实，
而且对不上的时候没有任何东西会报。代价是每次列表 join 一次聚合——
那是可以用索引解决的性能问题，计数漂移是没有解法的正确性问题。

### 为什么状态事件是**另一张表**

本体上的 `status` 是**当前值**，这张表是**怎么走到这一步的**。
只留当前值时，「为什么我提的这条一个月没人管」在系统里没有任何地方能回答。

---

## 2. 目标（`FeedbackTarget`）

判别联合，三种：`product` / `agent(agentId)` / `skill(skillId)`。

写成 `{ targetKind: string; targetId: string | null }` 时，
`{ kind: "product", id: "skill-7" }` 与 `{ kind: "skill", id: null }` 都能通过校验，
而两者都是没有意义的东西。判别联合让它们在**编译期**就构造不出来；
数据库那一半是 `product_feedback_target_pairing` 这条 CHECK。

**目标两列不加 FK**：agent 可停用、skill 可归档，而「当时有人对它提过意见」是历史事实。
`target_label` 存**当时的名字**，所以那条反馈在对象消失后仍然读得懂，而不是变成一个裸 id。

---

## 3. 状态机

```
                ┌──────────────┐
        ┌──────►│    待处理     │◄──────┐
        │       └──┬────────┬──┘       │
        │          │        │          │
        │          ▼        ▼          │
        │   ┌────────────┐  ┌──────┐   │
        └───┤ 已进入迭代  │  │ 不做  ├───┘
            └──────┬─────┘  └──────┘
                   │            ▲
                   ▼            │
              ┌────────┐        │
              │ 已修复  ├────────┘  ✗ 不是一条边
              └───┬────┘
                  │
                  └──────────────────► 待处理
```

| 从 | 到 |
|---|---|
| 待处理 | 已进入迭代 · 不做 |
| 已进入迭代 | 已修复 · 待处理 · 不做 |
| 已修复 | 待处理 |
| 不做 | 待处理 |

- **目标状态 = 当前状态** ⇒ 幂等重放：不落库、不写事件。
  管理员点两次「进迭代」不该在流水里留下两条转移——那个数字读起来像是有人在反复改判。
- **转 `不做` 必须带理由**。没有这个终态时，「我们不打算做这条」的唯一表达方式是
  把它永远留在 `待处理` 里，于是待处理队列变成一个只增不减的坟场；
  而一个没有理由的「不做」比不答复更伤人（D3 让提交人看得见这条判决）。
- **`已修复 → 不做` 不是一条边**。那条路读起来是「修好了，但我们决定不做」，
  没有任何一种真实情况长这样。真实情况是「我们发现之前判错了」——
  那要先回 `待处理`，让改判留下两条痕迹。

判定落在 `apps/api/src/domain/feedback/product-feedback.ts` 的 `triage()`（纯函数）；
数据库那一半是 `product_feedback_decline_needs_reason` 这条 CHECK。
后台屏那张按钮表是这张表的第二份副本，由
`apps/web/tests/ui/admin-feedback-transitions-match-domain.test.ts` 逐条对账。

---

## 4. 可见性（D3）

```
canReadDetail(viewer, feedback) = viewer.orgRole === "admin" ∨ viewer.id === feedback.submittedBy
```

- 返回 `boolean`，调用方据此决定 `detail` 是**原文还是 null**——**不返回脱敏摘要**。
  摘要是一种看起来无害的泄露：正文里的客户名往往就在第一句。
- 反馈**没有 `acl_bindings` 行**，所以它走 `permission-filter` 里绕开 `authorize()` 的那条：
  `ObjectRef.kind` 新增 `"feedback"`，`toAclRef` 对它直接抛错，逼调用方走
  `decideFeedbackDetailVisibility` + `discloseDecided`。
  不这样做的话 `authorize` 会找不到绑定、退回宽松默认 scope，把每个人的正文发给全组织，
  而界面看起来一切正常。
- 仓储把正文包成 `Guarded<string>`：载荷存在模块私有的 WeakMap 里，
  「忘了判 D3 就投影出去」因此是一个**编译不过**的东西。

分诊权限：`orgRole === "admin"`，**没有**「提交人可以关自己那条」的例外——
那是给状态机开一个不经分诊的旁路。

---

## 5. 与已签核束的边界

| 事实 | 唯一事实源 | 本束**不**声明 |
|---|---|---|
| 消息级 👍/👎 与归因 | `skills.ts` §六（F68） | `rateMessage` / `getSatisfaction` |
| 聚合改进建议、改进 PR、闭环度量 | `skills.ts` §六（F68） | `listSuggestions` / `getLoopMetrics` … |
| 组织角色 / 权限判定枚举 | `identity.ts`（phase-00 已签核） | 不新造 `PermissionReason` 第 9 个值 |

⚠ `getFeedbackCounts` 与 `skills.getLoopMetrics` **口径不同且不重叠**：
前者数软件反馈的状态分布，后者数「评价→建议→PR→上线」的转化。
两条都存在不是重复，合成一条才是——合了之后没有任何一个数字说得清自己是什么。
