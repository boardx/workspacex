# 组织首页 + 后台配置 —— 设计原型

> 用户提供了一张参考截图（宽版 labeled 侧栏 + Banner + 快捷入口 + 任务/公告侧栏），要求：
> 每个组织可以有自己的首页，后台有配置页（logo / 标题 / 一句话 / banner 等），配置完成后
> **全部成员登录后先进入自己组织的首页**。
>
> 这是**设计原型**（纯静态 HTML），未改生产代码。色值/圆角/阴影镜像
> `apps/web/app/globals.css` 的既有 token，左侧导航直接复用已核对过的真实结构
> （见 `docs/design/ai-workspace-redesign/v4-nav.html`：13 个一级入口、五段分组顺序不变，
> UC-0.4 R4 A1 锁定）。

| 文件 | 内容 | 截图 |
|---|---|---|
| `home.html` | 组织首页（成员视角） | `shots/home-default.png`（桌面）、`shots/home-mobile.png`（手机） |
| `home-admin.html` | 首页设置（组织管理员后台，带实时预览） | `shots/home-admin.png` |

## 与参考截图的差异，以及为什么

参考截图左侧是一条宽版、带文字标签的导航（Home / Chat / Projects / Board / Agents / Knowledge / Templates / People / Settings），这与目前生产代码里**已经确认、多轮人类裁决锁定**的
76px 窄图标栏（`apps/web/lib/navigation.ts` 的 `NAV_SEGMENTS`，13 个一级入口、五段分组，
UC-0.4 R4 A1）是两套不同的信息架构。本设计选择**忠于真实产品的导航**，只在其最上方新增
一条「首页」（见下方「未决问题」①），其余分组/入口原样保留——而不是照抄参考图那套导航,
那会让"评审看到的和用户实际用的不是同一个产品"（本仓已经因为这类不一致返工过，见
`ui-preview/README.md` 的历史教训）。

## 组织首页（`home.html`）

结构：**顶部搜索/通知/头像**（全局，不属于首页配置）→ **Banner**（logo/标题/一句话/背景，
全部来自后台配置）→ **Universal Ask**（向 WorkspaceX 直接提问/下达任务，压在 Banner 下沿）
→ **快捷入口 4 宫格**（后台可配置显示哪几个、顺序、文案）→ **最近内容**（项目/Board/文档/
对话四个 tab，读全局既有数据，不属于"首页配置"范畴）→ **右栏**（我的任务 / 组织公告 / 邀请
团队，各自独立开关）。

- 首页只在**用户登录后的第一落点**出现（对应参考图"Home"的位置），不替代 `/chat` 或
  `/projects` 本身——原有入口都还在，只是不再是登录后看到的第一屏。
- 底部浮动条`仅组织管理员可见：这是你们的首页 / 预览为普通成员 / 编辑首页`：管理员自己访问
  首页时看到，一键跳转到后台配置，不需要先找菜单。
- 响应式：≤860px 导航栏隐藏（复用真实 `icon-rail.tsx` 已有的 `md:` 断点做法）、单栏、
  快捷入口 2×2、Banner 收窄。

## 后台配置页（`home-admin.html`）

三栏：真实 `admin-nav.tsx` 视觉语言的后台左栏（新增「首页设置」一项）→ 中间表单 → 右侧
**实时预览**（内嵌 `home.html`，缩放展示，修改表单即时反映，支持切桌面/手机预览）。

配置项分四组，对应 `home.html` 里的四个区域：

1. **身份**：组织 Logo（复用既有 `Organization.avatarUrl` 字段）、标题、副标题（留空则自动
   显示"企业空间 · N 位成员"，与成员配额模块联动，不是第二份人工维护的数字）。
2. **横幅**：标题、一句话、背景（4 个预设渐变 + 自定义上传图片二选一）、可选的"观看介绍"
   按钮（文案 + 链接，留空则不显示，不强迫每个组织都要挂一个视频）。
3. **快捷入口**：最多 4 个，可拖拽排序、可关闭（关闭的入口本身功能不受影响，仍能从左侧
   导航访问——首页配置只决定"要不要在首页露出"，不是能力开关）。
4. **信息板块**：右栏"我的任务/组织公告/邀请团队/最近内容"四个板块的显示开关，关闭后数据
   仍在，只是首页不展示。

操作栏：`恢复默认` / `仅自己预览`（不影响其他成员看到的版本）/ `发布给全部成员`（真正生效的
动作）。草稿自动保存，未发布前只有编辑者自己看得到改动。

## 数据模型建议（未落地，仅供后续 feature 参考）

```
OrgHomeConfig {
  orgId: string
  title: string              // 默认取 Organization.name
  subtitle: string | null    // null = 自动显示成员数
  bannerHeadline: string
  bannerTagline: string
  bannerBackground: { kind: "preset"; key: string } | { kind: "image"; url: string }
  bannerCtaLabel: string | null
  bannerCtaUrl: string | null
  quickActions: Array<{ key: string; enabled: boolean; order: number }>  // 最多 4 个enabled
  sections: { tasks: boolean; announcements: boolean; inviteCard: boolean; recentTabs: boolean }
  publishedAt: string | null  // null = 仍是草稿，成员看不到
  draftUpdatedAt: string
}
```

## 未决问题（需要人类决定，本轮不擅自定）

1. **导航要不要真的加一条「首页」**：这是本设计唯一触碰到导航结构的地方（13 个入口 → 14
   个），需要走与 v4 图标栏重设计同样的"人类裁决"流程，不能因为这次是新 feature 就绕过去。
   备选方案：不新增导航项，首页只作为"登录后跳转落点"存在，用户之后可以从面包屑/logo 点击
   返回，不占一级导航——两种做法这里都画出了前者，具体选哪个留给人类。
2. **多组织成员登录后去哪个组织的首页**：沿用当前"最后一次所在的组织"，还是每次登录都回到
   某个"默认组织"？与既有 `org-menu.tsx` 的组织记忆机制的关系需要确认。
3. **未配置过首页的组织显示什么**：默认给一版"WorkspaceX 官方欢迎首页"（类似当前空白起点
   升级版），还是直接跳过首页、保留现状（登录后直接进对话）？
4. **首页是否允许"仅自己预览"之外的分级发布**（比如先给某个团队试点）——本轮只设计了
   全员发布 / 草稿两态，没有做分级。
