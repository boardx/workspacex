# contract · 可点击原型——页与页之间的跳转关系（迭代 11）

> 规范唯一来源。签核见 `design-signoff.md`，验收见 `verification.md`。
> 触发缘由：人类 2026-09-07 问「生成的原型，可以生成可点击、连贯的吗？」，并拍板
> **跳转关系由模型自动连（人可改）**。评估与拆解：issue #2917。挂靠束：`design-prototype`。

## §0 现状与病根

迭代 1–10 交付的是一棵**静态组件树**：画布上点节点是「选中它去改」（迭代 2 的
`focusNodeId`），不是跳转；21 个原语里没有任何一个带「点了去哪」——`button` 只有
`label`/`variant`/`full`。页与页之间零关系。所以它是可看、可改、可导出的高保真静态稿，
**不是能走通流程的可点击原型**。Claude Design 的原型能点着走完一条路径，这是本束登记的
差距之一（`contracts/design-prototype/domain.md` §5）。

## §1 词汇：跳转关系挂在**屏**上，不挂在节点 props 上

`packages/contracts/src/design-prototype.ts` 新增（只此一份）：

```ts
PrototypeLink = { from: PrototypeNodeId, item?: number /* ≥0 */, to: number /* 页序号 ≥0 */ }
PrototypeScreen.links?: PrototypeLink[]   // ≤ PROTOTYPE_MAX_LINKS(30)，可省略
```

- `from`：本页树里的一个节点 id。`item` 只对**多项原语**（`list` / `tabs` / `bottomnav`）
  有意义——指第几项；单目标原语（`button` / `chip` / `card` / `hero` / `navbar` 的左右按钮以
  `item: 0|1` 区分）不带 `item`。
- `to`：目标页在 `screens` 里的**序号**（0 起）。

**为什么不放节点 props（方案 A）而放屏级数组（方案 B）**：多项原语的 `items: string[]` 要配
一条平行的目标数组，而属性面板 `PROTOTYPE_FIELDS` 没有「按行给目标」这种字段类型，得新增一类
控件；且要动 5–8 个 `*Props` 与它们的机械门控（键集合 == shape 键集合）。屏级数组 **21 个
`*Props` 一个不动**，校验集中一处。

**为什么按序号不按标签**：仓库既有约定就是按位置配对（`prototype`/`frames`/`frameNotes`
三份平行数组按下标对应）；按标签会在改名时断。整页重生成时 `links` 随 `screens` 一起重给，
序号天然重算。

## §2 校验：项目级、逐条判，悬空只丢那一条

`links` 的合法性要看整份 `screens`（目标页存不存在），所以校验在 `DesignPrototypeWriteback`
的 `superRefine`（整页）与 `applyPrototypePatch`（局部）两处**同一个纯函数** `validateLinks`：

| 条件 | 处置 |
|---|---|
| `to ≥ screens.length` | **丢这一条**，记日志 `link dropped: target out of range` |
| `to === 本页序号`（自跳） | 丢这一条 |
| `from` 不在本页树里（含 `ensurePrototypeIds` 重分配过 id 的情况） | 丢这一条 |
| `item` 给了但 `from` 不是多项原语，或 `item ≥ items.length` | 丢这一条 |
| 同一 `(from, item)` 出现两次 | 保留第一条 |
| 一页 `links` 超过 30 条 | 截到 30 条（按顺序） |

⚠ **这与 I-10「一页被拒 ⇒ 整个 `prototype` 写回被拒」不同**——悬空的跳转不至于让整页
作废，页面本身仍然合法可用。这是本 delta 请人类拍板的取舍 ①（§7）。默认按上表（只丢那一条）。

## §3 模型侧：整页时自己给 id，局部时用 `setLinks`

- **整页写回**：模型在 `PrototypeScreen` 里直接给 `links`。由于 id 是服务端 `ensurePrototypeIds`
  补的，模型要连线就得**自己给那个节点写 `id`**（契约本来就允许，见 I-13）。若它写的 id 与别页
  重复被重分配，那条 link 按 §2 丢掉——这是可接受的退化，不是错误。
- **局部修改**：`PrototypePatchOp` 新增一种 `{ op: "setLinks", screen: number, links: PrototypeLink[] }`，
  整体替换某页的 `links`。属性面板（人改）与模型（patch）**走同一个 op**，同 I-11「人改与模型改
  同一条写回路径」。不做 `link`/`unlink` 两个 op：一个整体替换够用，校验只写一次。
- **prompt**：`PROTOTYPE_SCHEMA_GUIDE` 加一段（契约测试断言 `links`/`setLinks` 出现在说明里），
  设计原则加第 ⑧ 条「每个主操作按钮都要有去处；底部导航每一项都连到对应页」，few-shot 示例 1
  加上 `links`。

## §4 界面：编辑 / 预览两个模式；画板画连线

- 顶栏视图切换旁加**模式**开关：「编辑」（现状）/「预览」（`design-detail-mode-preview`）。
- **预览模式**下：有 link 的节点 `cursor-pointer` + hover 描边；点击 = 跳转（画板视图 ⇒ 聚焦
  目标页并高亮一次；单页视图 ⇒ 切到目标页）。没有 link 的节点点击无效。属性面板与焦点 chip
  隐藏（预览不是编辑）。切回「编辑」恢复选中态语义。
- **画板视图**（两种模式下都画）：页与页之间用 SVG 连线画出跳转关系（`design-detail-board-links`），
  从源节点右缘到目标页左缘，同一目标的多条线合并末端。连线随平移缩放一起变换（画在 stage 里）。
- **属性面板**（编辑模式）：选中节点后多一块「点击后跳转到」——单目标原语一个下拉（各页 + 无）；
  多项原语按项各一个下拉。改动发 `setLinks`。
- **说明页 / 导出**：设计文档每页多一小节「跳转」（`按钮「发送」 → 第 2 页「对话」`）；JSON 规格
  自动带 `links`（它挂在 screen 上）。PNG 不变。

## §5 存储：一屏的数据现在拆成三份平行数组——这是本 delta 最大的隐性成本

`design_projects` 与 `design_project_prototype_versions` 两张表都把一屏拆成 `frames` /
`prototype` / `frame_notes` 三列按下标配对。每加一项「每屏一份」的数据 = 一次迁移 + 两张表各
一列 + 读写两侧各一份长度不变量。**这个形状刚咬过一次**：#2900 修的正是「只写 `frames` 不写
`prototype` ⇒ 强制清空」导致用户整份原型丢失。

两条路，请人类拍板（§7 取舍 ②）：

| | A：收敛成单列 `screens jsonb` | B：再加第四列 `frame_links` |
|---|---|---|
| 做法 | 两张表各加 `screens jsonb`（每项 `{frame, root, notes, links}`），一次数据迁移把三列合进去，旧三列保留一个版本后删 | 照 `frame_notes` 的先例再来一遍 |
| 长度不变量 | **消失**（不再存在"对不上"这种状态） | 第四份，且 #2900 那类 bug 面积再扩一圈 |
| 代价 | 读写两侧重写（`toPrototype`/`toNotes` 合一）、fake 仓储同步、迁移要幂等可重放 | 小 |
| 建议 | **选 A**。现在是三份，本 delta 变四份，再往后（交互态/动效）就是五份 | 只在人类要求本迭代压到最小时选 |

## §6 范围外（本 delta 不做，登记）

- 浮层 / 弹窗 / 返回栈（只有「跳到某页」一种动作）。
- 页与页之间的转场动效。
- 条件跳转（点了之后按状态去不同页）。
- 人手拖线连页（属性面板下拉够用；拖线是画板交互的另一个迭代）。

## §7 请人类拍板的三处取舍（实现按「建议」先做，签核时可改）

1. **悬空跳转怎么处置**：**A（建议）只丢那一条、页面保留** / B 沿用 I-10 整个 `prototype` 拒。
2. **存储形状**：**A（建议）收敛成单列 `screens jsonb`** / B 加第四列。选 A 工作量约 +40%，
   但换掉一整类"按位置对应"的脆弱性。
3. **预览模式下画板是否仍可点选编辑**：**A（建议）不可，预览就是预览** / B 可，按住 Alt 选中。

## §8 本 delta 顺带追认的一处既有不变量修改

#2900（2026-09-07 合并）把 I-8/I-19 的守法方式从「只写 `frames` ⇒ 清空 `prototype`」改成
「**等长保留，长度对不上才清**」，并在应用层拒掉会改页数的 frames-only 写回。这是修用户实测
的数据丢失，实现先行；`contracts/design-prototype/domain.md` 的 I-8 / I-19 与 `coverage.md`
V12 已随本 delta 的 PR 同步改文，签核时一并追认。
