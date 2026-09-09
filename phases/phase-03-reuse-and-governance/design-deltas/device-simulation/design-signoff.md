---
status: confirmed
bundle: device-simulation
base_bundle: design-prototype
scope: preview-device-simulation-lens-phone-tablet-laptop-desktop-rotation
covers: []
confirmed_by: "usamshen"
confirmed_at: "2026-09-09T02:40:00Z"
confirmed_via: "PR #3185"
---

# design delta 签核 · 预览时切换模拟设备（迭代 14）

⚠ `status`、`confirmed_by`、`confirmed_at`、`confirmed_via` 只能由人类修改；agent 不代签
（ADR-023 / AGENTS.md「设计签核（三件、一处签）」）。本文件由 agent 起草，**status 停在 pending**。

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

人类 2026-09-08 交办：「对于 web 在预览的时候，有不同的设备的模拟的 view，比如 laptop，pad，
iPhone 等，模拟效果。」这是**实现先行**（人类当时要求「不要再问我问题，直接迭代出来 PR」），
所以本签核是**追认**，不是先签后做——请按下面三节逐项核对实际做出来的东西。

## ① UI

见 [contract.md](./contract.md) §4、§5。预览区上方多一个设备切换器（下拉 + 旋转按钮），
画板按真实逻辑分辨率渲染再整体缩放，外面套机身 chrome。

重点确认：
- 五款预设够不够：iPhone SE 375×667 / iPhone 15 393×852 / iPad 820×1180 /
  笔记本 1280×800 / 桌面 1440×900。**加一款的判据是「有人真的会用它做设计决定」**，
  不是「再多几个看起来更全」。
- 机身 chrome（灵动岛、状态栏、home 条、浏览器交通灯）是**装饰**，不可选中、不进导出。
  要不要更朴素一点（只留边框和圆角）？
- 交通灯用的是语义 token 而不是 macOS 字面色值，所以浅/深主题下会跟着变——接受吗？

## ② 用例

见 [verification.md](./verification.md) **V71–V77**，重点看这几条是不是你要的行为：

- **V74 只缩不放**：画板永远不放大。把 393px 的手机放大到占满面板，字会跟着变大、
  看起来"很清楚"，而那恰恰掩盖了「这行字在真机上有多小」——正是模拟要回答的问题。
- **V75 镜头不写库**：换个尺寸看一眼**不会改别人的项目**。
- **V73 桌面不可旋转**：即使 landscape 状态还留着也不生效，否则切到桌面会变成 800×1280 的竖条。
- **V76 默认镜头跟模板走**：mobile ⇒ iPhone，ui ⇒ 笔记本，wireframe ⇒ iPad。

## ③ API 契约

**本 delta 不改 API，不加路由，不加错误码，不动数据库。** 这是它最重要的一条契约决定：

设备是**预览时的镜头**，只存在组件状态里，不进 `DesignProject`（`contract.md` §1 的取舍 A）。
备选 B 是像 `theme` 那样 PATCH 进项目——被否掉的两个理由：
① 换个尺寸看一眼就改了别人的项目；
② 这套原语**没有断点**，切到 iPhone 不会让原型变成"响应式之后的样子"。
把一个不产生响应式行为的开关写进项目，会让读到它的人以为那里有响应式设计。

唯一事实源是 `apps/web/lib/prototype-devices.ts` 一张表。⚠ 迭代 6 的
`PrototypeDevice`（phone|tablet|desktop）与 `DEVICE_SIZE` **已删除**——它们是第二份尺寸声明。

## 请人类拍板的一处取舍

| # | 取舍 | 建议 | 备选 |
|---|---|---|---|
| ① | 设备是镜头还是项目属性 | **A** 镜头，不写库（已实现） | B 写进项目，像 theme 一样 PATCH |

若与建议不同，把选择写在下面这行，agent 按它改：

> 人类选择：① ＿
