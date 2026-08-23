# 原始需求 — 动效 Token 体系

估点 **6**

> 来源：2026-08-23《WorkspaceX 十分制评估》P0 缺口「交互与动效系统」+《十分冲刺 Backlog》IT-02。

## R1 概览
- **Use Case 名称**：建立语义化动效 token，替换散装 transition 数值
- **Actor**：全站用户（体验一致的动效节奏）；开发 agent（未来新增交互时有标准可用）
- **目标**：全仓 167 个文件手写 `transition-*`，duration/easing 数值各写各的，没有语义命名的 token。目标是建一套 2-3 档动效 token（如 fast/base/slow），并挑 1-2 个真正值得"编排"的时刻（如消息到达、面板展开）做成有节奏的动效，而不是所有元素统一套用一个 200ms ease。
- **系统边界**：`apps/web/tailwind.config.ts`、`apps/web/app/globals.css`、依赖 IT-01 产出的 4 个弹层组件（作为首批接入范例）、chat 消息列表相关组件

## R2 前置条件 / 触发条件
- **前置条件**：「01-component-primitives-overlays」已完成或至少已定稿新组件结构，本 feature 需要有真实落点可以接入新 token
- **触发条件**：本 feature 开工时；或后续任何 feature 新增动效时必须使用本 token 而非裸数值

## R3 主流程
1. 在 `tailwind.config.ts` 定义 `transitionDuration` / `transitionTimingFunction` 的语义档位（例如 `fast`=120ms、`base`=200ms、`slow`=320ms，具体数值需在 `globals.css` 注释里写明选值依据，禁止无理由拍数字）
2. 把 IT-01 产出的弹层组件的进出场动画迁移到新 token，作为示范
3. 设计并实现 1-2 个"编排级"动效：候选是 chat 消息到达时的进场效果、侧边面板展开/收起。编排级意味着有明确的时间线（如内容先淡入、位移后跟上），不是单一属性的线性过渡
4. 在 `lint-design.sh` 新增规则：检测裸 `duration-[0-9]+` 或 `ease-[a-z-]+` 未走语义 token 的用法（比照现有 U5b 任意像素规则的实现方式）
5. 全仓存量的 167 处手写 transition 逐步迁移（可分批，不要求本 feature 一次性改完，但需给出迁移优先级：先改高频交互组件）

## R4 备选流程与异常流程
- **备选流程**：
  - A1：某处动效需要比 slow 更长的时长（如长列表滚动定位）——允许在语义档位之外声明特例，但需要注释说明原因，不能悄悄绕过 lint
- **异常流程**：
  - E1：用户系统开启了"减少动态效果"（`prefers-reduced-motion: reduce`）——所有编排级动效必须可被这个媒体查询关闭或降级为瞬时切换，微交互级的 transition（如 hover）可保留但需缩短
  - E2：动效 token 迁移过程中某个业务组件因为强依赖旧的具体数值（如与外部库联动的时长）暂时无法迁移——记录为已知例外，不阻塞其他部分

## R5 权限与可见性
- 无业务权限差异；所有用户看到相同的动效语言（除非触发 R4-E1 的系统级降级）

## R6 后置条件 / 不包含
- **后置条件**：`tailwind.config.ts` 有语义化动效 token；至少 1-2 处编排级动效落地；lint 新规则生效
- **不包含**：不要求本 feature 一次性迁移全部 167 处存量用法，允许分阶段；不引入 framer-motion 等新的动画库依赖（当前技术栈是纯 CSS transition，保持一致）

## R7 业务规则
- 动效必须服务于用户理解状态变化（如"这个面板是展开的还是收起的"），不能为了炫技增加与状态无关的装饰性动画
- 编排级动效的存在必须有设计说明（为什么这个时刻值得编排），不能是开发者随手加的

## R8 界面线索
- 前端入口：弹层的进出场、chat 消息列表的到达动画、侧边面板的展开/收起
- 线框/参考：无既有截图，属于本阶段新设计内容，需在 UI 先行阶段产出预览
- 提醒：本 feature 属于 has_ui 阶段，开工前需人类签核

## R9 非功能约束
- 性能/规模预期：动效不应引入明显的掉帧或阻塞主线程的重排；chat 消息高频到达场景（如流式输出）需验证动效不拖慢渲染
- 安全/隐私/合规：无特殊要求
- 兼容与降级要求：`prefers-reduced-motion` 降级必须验证生效

## R10 已知约束 / 依赖
- 依赖「01-component-primitives-overlays」的产出作为首批接入范例
- 技术约束：保持纯 CSS transition 路线，不新增动画库依赖

## R11 切分提示
- 期望粒度：token 定义 + lint 规则可作为一个 feature；编排级动效设计可作为另一个 feature（如果工作量评估超出单次会话能完成的范围）
- 优先级：依赖 IT-01，本阶段第二优先级

## R12 AI Ready 验收线索
- 可验证行为：`tailwind.config.ts` 能看到语义化 duration/easing 定义；`lint-design.sh` 新规则跑通，故意写一个裸 `duration-500` 能被拦截；至少一处编排级动效在浏览器里可演示；`prefers-reduced-motion: reduce` 下动效可关闭（人工验证 + 截图）
