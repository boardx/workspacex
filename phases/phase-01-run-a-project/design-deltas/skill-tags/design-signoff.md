---
status: proposed
bundle: skill-tags
base_bundle: skills
scope: skill-record-tags-field
covers: []
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# design delta 签核 · Skill 记录新增 `tags?: string[]`

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。coord-main 可代人类在
会话内确认后把这份改成 `confirmed`（同 `shared-invite-links` / `token-quota-and-usage`
先例），但那次确认要在这份文件或对应 PR 评论里留痕。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。

## 这份 delta 为什么存在

本轮 `/skill` 后台修复（人类看真实截图报的 8 个问题）里，G5「新建时支持添加 tags」
是唯一一条界面上要出现一个**契约里完全不存在**的概念——2026-08-13 那一轮
（`skill-catalog-live.tsx` 的 tag 过滤 chip）已经复核过一次，结论是用三个既有封闭
枚举顶替，不新开契约面；这一轮人类原话把「新建时添加 tags」单独点出来，三个既有枚举
顶替不了「使用者自由打的标签」这件事，只能新增字段。ADR-023 把「新增设计面」（哪怕
可选、哪怕范围小）排除在免签核之外，所以本轮不能像 F158/F164 那种纯前端改动一样
直接推进，需要这份轻量签核记录。

## ① UI

`/skill?screen=library` 的「新建 Skill」弹窗（G3，见同一个 PR）在「完全新建（契约表单）」
这一个 tab 里新增一个 tags 输入（逗号分隔文本框，简单可用，不引入新的 chip-input 组件）；
卡片上 `tags.length > 0` 时新增一行 chip 展示。均见 `contract.md` §4「本轮不做的扩展」——
浏览页过滤维度本轮不扩展到 tags。

## ② 用例

新建 Skill（声明式契约表单）这条既有用例（UC-3.1 R3）的入参新增一个可选字段，不改变
用例本身的判定顺序（来源标记 → 静态契约校验 → 数据范围越权 → 落草稿）——tags 不参与
任何一步判定，只是随其它字段一起落库。

## ③ API 契约

两处新增，见 [`contract.md`](./contract.md) §1：`SkillListItem.tags`
（`z.array(z.string()).default([])`）、`createSkillDraft.in.tags`
（`z.array(z.string()).optional()`）。零新增错误码，零删除/修改既有字段。

---

## 怎么签

把上面的 `status: proposed` 改成 `status: confirmed`，并补上：

```yaml
status: confirmed
confirmed_by: "<你的名字，或 'coord-main 代抄确认' 并注明依据>"
confirmed_at: "<ISO8601 时间戳>"
confirmed_via: "<在哪次会话/哪条消息里确认的>"
```

`contract.md` §5 列了两条需要明确回答的取舍；若否定其中任何一条，请在本文件里写明
否定哪一项、改成什么，实现按新裁决调整。
