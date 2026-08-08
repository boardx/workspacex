---
name: uiux-designer
description: >
  激活条件：用户提到 UIUX、用户体验、可用性、页面布局、交互设计、视觉美感、
  暗黑模式、配色、动画过渡、微交互等关键词时触发。
  基于 shadcn/ui 和 Tailwind CSS 的最高美学标准，对前端界面进行体验规划、视觉升级与自主审计。
---

# UIUX Designer Skill (Tailwind & shadcn/ui Edition)

## 何时使用

每当接收到涉及前端 UI 界面、页面布局、用户交互流程、整体视觉美化或体验改进的需求时激活。

该 Skill 的核心目标是：**拒绝简陋、低品质的 MVP 界面，通过 shadcn/ui 及其高度可定制的 Tailwind CSS 体系，构建符合现代最高标准的 Web 体验。**

> 相关规范参考：
> - 设计系统标准：[uiux-standards.md](.harness/instructions/uiux-standards.md)
> - 走查审计模板：[uiux_audit.template.md](.harness/templates/uiux_audit.template.md)
>
> ⚠ **本文件不复制 uiux-standards.md 的具体规则值**（token 名、间距刻度、类名写法）。
> 具体规则该长什么样，永远去查权威文件；本文件只讲方法论——怎么想、按什么顺序审、
> 什么信号说明该往哪个方向查。

---

## 能力清单（这个 skill 让你具备的动作）

- 在写页面前先查 `components/ui/` 是否已有可复用基础组件，判断"复用/扩展/新增"三选一。
- 按「构思 → 编码 → 自审」三步走完整个工作流，而不是只做编码这一步就收工。
- 执行「边缘状态防御」设计判断：一个界面元素是否需要 loading/empty/error 三态，
  以及三态该用骨架屏还是文字提示（具体实现模式见 `uiux-standards.md` §6）。
- 执行自审走查：本地渲染 → 按 `uiux_audit.template.md` 逐项检查 → 截图存证 →
  `git ls-tree HEAD` 核实证据已入库 → 补齐关键交互元素的 `data-testid`。
- 识别"这是不是在制造第二份规则副本"的信号（例如想在组件里手写一个颜色值、
  想在页面级重新定义一套间距）——识别到就停下改查 `uiux-standards.md`，不是自己发明。

---

## 架构知识：这一环节在整条防线里的位置

本仓对 UI 质量的把关是三层防线，各自职责不同，**互不替代**：

```
设计意图判断（本 skill：审美/交互取舍）
        │
        ▼
机械检查兜底（lint-design.sh / check-token-contrast.mjs：拦硬编码色值、
        │      拦对比度不达标、拦裸原生表单元素——查得到的都是"有没有"，
        │      查不到"好不好"）
        ▼
人类签核（束级 design-signoff.md 第①节：界面落点与截图对不对）
```

本 skill 存在的意义正是补上机械检查查不到的那部分：lint 能拦住"用了硬编码颜色"，
拦不住"这个空状态设计得让用户不知道下一步该做什么"。反过来，本 skill 的自审判断
不能替代机械检查——两者都要过，缺一层就是防线出现豁口。

与相邻 skill 的边界：[ui-prototyper] 决定"做哪些屏、覆盖哪些用户故事"；
本 skill 决定"这一屏做得够不够好"。同一次实现里常常两顶帽子都要戴，
但判断标准不同，不要用"截图存证齐了"替代"走查通过"，反之亦然。

---

## 领域/商业知识：为什么这套系统这样设计

**本仓真实教训**（讲清"为什么架构要这样"，不复述具体修复的类名/数值）：
- 2026-07-09 disabled 按钮对比度事故：根因不是某一页写错，而是"用统一透明度
  实现禁用态"这个**架构选择**本身在深色实心控件上必然产生低对比度——单页修复
  治标不治本，真正的修法是把"语义状态"和"视觉呈现"解耦到 token 层。这是本 skill
  "边缘状态防御"判断力要覆盖的那类问题：不是"这页对不对"，而是"这套模式会不会
  在下一个页面重演"。
- 2026-07-10 字号档位三份副本漂移事故（ADR-013）：手抄清单必然漂移，即使抄的时候
  是对的，24 小时后第三份副本就会掉队。这是本文件"不复制具体规则值"这条硬约束的
  直接来源——本文件自己也不能变成第四份副本。

**外部最佳实践佐证审查思路**（不是抄具体类名，是抄"审什么、按什么顺序审"）：
- **Radix 的可访问性是默认给的，但不是全给**：Radix 组件默认处理键盘导航、焦点管理、
  ARIA 语义，但颜色对比度、标签文案、语义变更后的行为仍是开发者的责任——所以自审
  清单里"改了组件语义（如把 div 换成 button）之后要重新测键盘/屏幕阅读器行为"
  是一条不会因为规则数值变化而过时的检查思路。
- **WCAG 的 POUR 四原则**（可感知 Perceivable / 可操作 Operable / 可理解 Understandable /
  健壮 Robust）可以当审查时的"分类框架"，帮助判断一个走查发现属于哪一类问题、
  该往哪个方向修——这是思维框架，不是本仓新增的数值门槛（数值门槛已经由
  `check-token-contrast.mjs` 机械跑，见 `uiux-standards.md` §1.1）。
- **公开审计发现的高频问题类型是"焦点可见性"**（focus ring 在多个主题下对比度不足）——
  这提示自审时焦点态不能只看"有没有 ring"，还要在亮/暗两套主题下都看一眼是否
  真的看得清，而不是假设默认样式就够用。
- **组件驱动开发（CDD）的"由小到大"顺序**：先做最小可复用单元、用变体覆盖交互态，
  再组合成页面——这支撑"构思与规划"步骤里"梳理需要的 shadcn/ui 基础组件清单"
  这一步该在写页面代码之前完成，而不是边写边想缺什么组件。

参照（本轮调研，仅作方法论佐证，不作为门控依据）：
- [shadcn/ui Accessibility: asChild, Focus, and ARIA](https://eastondev.com/blog/en/posts/dev/20260330-shadcn-radix-accessibility/)
- [shadcn/ui Accessibility Audit 2026](https://thefrontkit.com/blogs/shadcn-ui-accessibility-audit-2026)

---

## 核心设计与交互准则 (Tailwind & shadcn/ui 实践)

### 1. 极致美学与细节 (Wow-Factor & Theme Mapping)
- **语义化配色、间距网格、字阶**：具体 token/类名清单**不在这里复制**——唯一权威是
  [uiux-standards.md](.harness/instructions/uiux-standards.md)，`lint-design.sh` 机械
  拦截违规写法。本 skill 只提醒方法论：拒绝硬编码颜色（如 `bg-[#ff0000]`）、拒绝魔数
  任意值类（如 `p-[13px]`），一律走 uiux-standards.md 里定义的语义变量与间距刻度。
  **不要凭记忆在这里默写具体类名**——已经出过 skill 里写的写法与 standards.md
  规则直接冲突、被 lint 拦下的事故，两处各写一份必然早晚对不上。
- **视觉纵深**：合理运用 `shadow-sm`、`shadow-md` 等 Tailwind 阴影类。在弹窗和浮层上，使用 `backdrop-blur-md bg-background/80` 创造现代的 Glassmorphism 质感。

### 2. 交互状态的完整性
在编写交互组件时，必须利用 Tailwind 的状态修饰符（**具体类名/是否允许 `disabled:opacity-*`
以 [uiux-standards.md](.harness/instructions/uiux-standards.md) §1.1 为准**——本 skill 不
复述，那条已经改过一次、被 `lint-design.sh` 机械拦截，写在这里只会再漂移一次）：
- **悬停态 (Hover)**：使用 `hover:bg-accent hover:text-accent-foreground` 或微缩放 `hover:scale-[0.98] transition-all`。
- **点击态 (Active)**：使用 `active:scale-95` 等微交互效果，让按钮感觉是“可按压的”。
- **聚焦态 (Focus)**：必须提供显眼的 `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none` 以支持键盘导航。
- **禁用态 (Disabled)**：具体 token 用法见 `uiux-standards.md` §1.1「对比度架构」——禁用态必须走 token 对，禁止用 `disabled:opacity-*` 实现（已有一次因此导致的可读性事故，现由 lint-design.sh 机械拦截）。

### 3. 可用性与状态防御设计
- **Shadcn 组件复用**：在编写页面之前，检查 `components/ui/` 下是否有现成的 UI 基础组件。如果没有，可以建议导入（如 `npx shadcn-ui@latest add [component]`）或自行基于 Radix + Tailwind 规范实现。
- **类名合并最佳实践**：使用 `cn(...)` 工具函数来处理动态类名合并：
  ```tsx
  import { cn } from "@/lib/utils" // 视具体项目的 utils 路径而定
  
  export function CustomCard({ className, active }) {
    return (
      <div className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm transition-all",
        active && "border-primary ring-2 ring-primary/20",
        className
      )}>
        ...
      </div>
    )
  }
  ```
- **边缘状态防御**：
  - 加载中首选 shadcn/ui 的 Skeleton（骨架屏）而非生硬的 Loading 菊花图。
  - 数据为空时设计包含图标、核心说明及 Action 按钮的精致 Empty State 卡片。

---

## UIUX 工作流规范

### 第一步：构思与规划
1. 明确操作主径，优化信息架构，确保主路径无干扰。
2. 梳理需要的 shadcn/ui 基础组件清单。

### 第二步：高标准编码
1. 严格使用 Tailwind utility classes，并配合 `cn(...)` 动态传参。
2. 禁用任何非标准行内样式（如 `style={{ paddingLeft: '17px' }}`）。
3. 确保所有交互逻辑都带有平滑过渡：在主容器或交互元素上应用 `transition-all duration-200 ease-in-out`。

### 第三步：自审与走查 (Self-Audit)
1. 在浏览器中本地渲染预览（用浏览器 MCP 工具或本地命令；界面先行阶段可复用
   `.agents/skills/ui-prototyper`/`rev-uiux`）。
2. 根据 [uiux_audit.template.md](.harness/templates/uiux_audit.template.md) 逐项自检（是否滥用 Tailwind 任意值、交互是否完整等）。
3. 生成走查截图，编写报告并提交至 `evidence/` 目录归档。
4. 归档后用 `git ls-tree HEAD -- <evidence路径>` 确认截图/报告真的进了 git 树
   （没被 `.gitignore` 挡住）——不在仓库里的证据等于不存在。
5. 界面关键交互元素补齐稳定 `data-testid`，供 e2e/verification 锚定（不锚文案或 DOM 结构）。

---

## 迭代/进化机制

1. **谁踩坑谁回流**：走查中发现一类会在多页面重演的架构性问题（不是单页笔误），
   在同一 PR 里往「领域/商业知识」的"本仓真实教训"追加一条**结论摘要**（讲清根因是
   什么架构选择导致的），具体规则值改到 `uiux-standards.md`——两处写的是不同层面的
   事实（本文件写"为什么"，标准文件写"是什么"），不要在本文件里连规则值一起抄。
2. **红线（2026-08 已修过一次，不得回归）**：本文件禁止出现具体 token 名、
   间距刻度、Tailwind 类名写法、颜色数值——任何"该用哪个 class"的问题一律引用
   `uiux-standards.md`。新增内容前先自查"这一句是方法论还是规则值"，是规则值就删掉
   改成引用。
3. **外部参照的时效性**：shadcn/ui、Radix、WCAG 相关的外部参照每隔几个迭代周期
   应该重新核实链接与结论是否仍然成立（组件库版本会变），过时的参照标注日期存档，
   不静默删除（便于回溯当时的判断依据）。
