import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * #1884：Monaco Editor 自托管（不接 CDN）——与仓库既有的 `mermaid`/`fabric` 走同一条路子：
 * npm 装的包被静态复制进 `public/`，浏览器不对外发起脚本请求。`@monaco-editor/react`
 * 默认行为是从 jsdelivr CDN 拉 `vs/loader.js`，那条路径在离线/CSP 受限环境下不可用——
 * 本仓门控与真栈 e2e 常跑在隔离环境里，不能依赖外网可达。
 *
 * 选择「复制预构建的 `monaco-editor/min/vs`（AMD 版）到 `public/monaco-editor/vs`，
 * 由 `@monaco-editor/react` 的 `loader.config({ paths: { vs: ... } })` 指过去」，
 * 而不是走 `monaco-editor-webpack-plugin` + ESM 打包：后者需要额外处理 Monaco 自带的
 * CSS（`editor.main.css`）与 worker chunk 命名/`MonacoEnvironment.getWorkerUrl` 手动接线，
 * 在 Next 14 app router 下两处都有已知坑；`min/vs` 是 monaco 官方发布的可直接部署产物，
 * AMD loader 自己处理 worker 加载，不需要额外的 webpack 配置。
 *
 * 复制发生在 `next.config.mjs` 求值期（`next dev`/`next build` 每次启动都会跑到这里）而
 * 不是 npm 生命周期钩子（`predev`/`prebuild`）——pnpm 默认不保证会跑除
 * `install`/`start` 外的 pre/post 钩子，写在这里则与 Next 的启动路径绑死，不依赖
 * 包管理器的钩子配置。`existsSync` 短路：源目录不变时跳过复制，不拖慢日常 `next dev`。
 */
const monacoVsSrc = join(__dirname, "node_modules/monaco-editor/min/vs");
const monacoVsDest = join(__dirname, "public/monaco-editor/vs");
if (existsSync(monacoVsSrc) && !existsSync(monacoVsDest)) {
  cpSync(monacoVsSrc, monacoVsDest, { recursive: true });
}

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  /**
   * ⚠ 2026-08-18 实测（真栈 + 真实百炼 `qwen3.8-max` 跑 pptx skill 试跑）：
   * Next 的 rewrite 代理**默认 30s 就掐断连接**（`proxyTimeout` 未配时的内建默认），
   * 而一次把 20KB 的 `SKILL.md` 当 system prompt 的真实模型调用，实测
   * 开思考 200-300s、关思考也要 33.5s——**两种都超过 30s**。
   *
   * 掐断之后的症状极具误导性：不是超时报错，而是 `socket hang up` →
   * 代理回一个**纯文本** `Internal Server Error` → 前端 `JSON.parse` 崩掉，
   * 界面上显示 `Unexpected token 'I', "Internal S"... is not valid JSON`。
   * 看起来像前端解析 bug，实际是代理超时。（解析那一半已在
   * `lib/api-client.ts` 一并修掉，见那里的长注释；但**根因是这条超时**。）
   *
   * ⚠ 这条 rewrite 代理只在 e2e / 同源代理部署里生效（`FULLSTACK_E2E_API_ORIGIN` /
   *   `CHAT_READ_E2E_API_ORIGIN`），生产里浏览器直连 API。所以这条改动修的是
   *   **门控与本地验证够不够得着长模型调用**，不是生产超时——生产那一半的正解是
   *   把长调用转异步（同 `AgentRun` 已有的提交→轮询形态，R9「>10s 转异步任务」），
   *   不是把每一层网关超时都往上调。
   *
   * 300s 取自实测上界（开思考的最坏情况）再留一点余量，不是拍脑袋。
   */
  experimental: { proxyTimeout: 300_000 },
  eslint: { dirs: ["app", "components", "lib"] },
  // 生产门控校验用独立的 dist 目录：否则 `next dev` 与 `next build` 争抢 .next，
  // 会出现 "Cannot find module ./vendor-chunks/..." 这类假故障。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /**
   * DA-19 —— `@copilotkit/react-core/dist/v2/index.mjs`（`@copilotkit/react-core/v2`
   * 的唯一公开入口，`CopilotKit`/`useAgent`/`useCopilotKit` 都从这里导出，见
   * `package.json` 的 `exports` 表——没有能绕开它单独拿到这些 API 的子路径）在模块
   * 顶层无条件 `import "./index.css"`，那份 CSS 是 Tailwind v4 编译产物
   * （`@layer properties`/`@layer base` 等语法）。本仓 `postcss.config` 走的是
   * Tailwind v3 一代插件，处理到这份文件时报
   * `` `@layer base` is used but no matching `@tailwind base` directive is present ``
   * ——不是某个具体组件的 bug，是两代 Tailwind 语法在同一条 PostCSS 管线里天然不兼容，
   * 实测（DA-19 e2e 三轮：直接删本仓自己的 import 无效，因为 import 在依赖包内部；
   * 清空 webpack 持久化缓存无效，因为它是模块图的一部分，不是缓存伪影）。
   *
   * 用 `NormalModuleReplacementPlugin` 把这一个资源路径换成本仓自己的空 CSS 文件
   * （`lib/empty-copilotkit-v2-styles.css`）——只影响这一份样式表的内容，不改变
   * `CopilotKit`/`useAgent` 等运行时 API 的任何行为（它们都不依赖这份样式），也不
   * 影响其它任何路由或依赖包的 CSS 处理。`@copilotkit/react-ui/styles.css`
   * （`globals.css` 已引入的那份，见其头注）是完全独立的另一个包/文件，不受影响。
   */
  webpack(config, { webpack }) {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /@copilotkit[\\/]react-core[\\/]dist[\\/]v2[\\/]index\.css$/,
        join(__dirname, "lib/empty-copilotkit-v2-styles.css"),
      ),
    );
    return config;
  },
  /**
   * 2026-08-25（#2044，人类原话「路由要改为 chat，不要 chat/copilotkit-v2，潜入到
   * 整体框架」）：方向对 #2026 翻转过来——CopilotKit v2 体验现在**原生**住在
   * `/chat`（`app/chat/page.tsx` 直接渲染，不再 redirect），旧灰度地址
   * `/chat/copilotkit-v2{,/:threadId}` 反向薄跳转到新地址（路由文件保留，兼容
   * 书签/在途 PR，下一轮再清）。
   *
   * 仍放 HTTP 层而不是页面组件里——#2026 两次实测的教训原样适用：App Router 的
   * 组件级 `redirect()` 在 dev 动态渲染下退化成 meta-refresh 客户端跳转，
   * Playwright `page.goto()` 因原导航被新导航中止而报 `net::ERR_ABORTED`
   * （预热 API 路由无效，是渲染层跳转机制本身）。
   *
   * 裸 `/chat` 那条 307（#2026）已删除：v2 原生住进 `/chat` 后它失去意义；带
   * `projectId` 的深链由下面 `rewrites()` 的 `chatLegacyBranchRewrites` 引到
   * `/chat/legacy` 渲染旧屏——issue #2457 起，这是**唯一**还落在旧屏上的场景
   * （项目内对话本轮不支持迁移，人类 2026-09-01 裁决）。带 `thread`、不带
   * `projectId` 的纯个人线程深链已经改走 v2 的 `/chat/:threadId`，见下方
   * `chatPersonalThreadDeepLinkRewrite`。
   */
  async redirects() {
    return [
      {
        source: "/chat/copilotkit-v2",
        destination: "/chat",
        permanent: false,
      },
      {
        source: "/chat/copilotkit-v2/:threadId",
        destination: "/chat/:threadId",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    /**
     * issue #2067 —— 带 `?projectId=`/`?thread=` 的 `/chat` 深链渲染旧屏
     * （`ChatReadScreen`/`PersonalChatScreen`），逻辑与 `/chat/legacy` 逐字相同
     * （`app/chat/legacy/page.tsx`）。这条**必须**放在 `beforeFiles`，不能像下面
     * e2e 用的那些放在默认的 `afterFiles` 位置——`/chat` 本身是一个真实存在的
     * 静态页面（`app/chat/(v2)/page.tsx`），Next 的路由优先级是
     * headers → redirects → beforeFiles rewrites → **文件系统路由（静态页面命中
     * 在这一步）** → afterFiles rewrites → 动态路由 → fallback；`afterFiles`
     * 位置的规则只在文件系统路由**没有命中**时才有机会跑，而 `/chat` 永远会先命中
     * 自己的 `page.tsx`，query string 不参与文件系统路由匹配，所以放
     * `afterFiles`（乃至更靠后的位置）永远不会被触发——必须用 `beforeFiles`
     * 抢在文件系统路由判定之前拦截。
     *
     * 这两条**始终生效**（不像下面的 e2e API 代理那样只在设了
     * `FULLSTACK_E2E_API_ORIGIN`/`CHAT_READ_E2E_API_ORIGIN` 时才生效）——查询参数
     * 分支旧屏是正式产品行为的一部分，不是测试专用设施。
     *
     * 为什么要挪出 `app/chat/page.tsx` 自身的分支逻辑、改用这里的 rewrite：
     * `app/chat/(v2)/layout.tsx`（AppShell + CopilotKit providers，见该文件头注）
     * 只能包住整个 `(v2)` 路由组——如果 `/chat` 的三路分支（v2 / 旧项目屏 /
     * 旧个人屏）继续放在同一个 `page.tsx` 里、又要挪进 `(v2)` 组去共享 AppShell，
     * 旧屏两支会被套进第二层 AppShell（它们自己已经各自 `<AppShell>` 包裹一次）。
     * 用 rewrite 在路由匹配阶段就把这两支整个引到 `/chat/legacy`（已经是这两个
     * 组件的既有正式入口），`(v2)/page.tsx` 因此只需要处理 v2 这一支，不需要
     * 再判断 query string，也就没有双重 AppShell 的风险。
     *
     * issue #2457（DA-19h 阶段一：旧手写轨道退役，范围收窄为「仅个人对话」）——
     * `?thread=` 深链原本也在这两条规则里被无条件送去 `/chat/legacy`，现在拆开：
     * 带 `projectId` 的（项目内对话）仍然去旧屏，**本轮明确不支持迁移**（人类
     * 2026-09-01 裁决，见 issue #2457/#2459）；不带 `projectId`、只带 `thread`
     * 的纯个人线程深链改去 v2 的 `/chat/:threadId`——issue #2459 已核实这条路径
     * 早就建好（历史回填/线程列表选中态/URL 持久化/真栈 e2e 全部覆盖），不需要
     * 额外开发，只是路由没接过去。`missing: projectId` 让这条规则与上面那条
     * 互斥，不依赖数组顺序里"谁先匹配谁生效"这种隐式行为。
     */
    const chatLegacyBranchRewrites = [
      { source: "/chat", has: [{ type: "query", key: "projectId" }], destination: "/chat/legacy" },
    ];

    const chatPersonalThreadDeepLinkRewrite = {
      source: "/chat",
      has: [{ type: "query", key: "thread", value: "(?<threadId>.+)" }],
      missing: [{ type: "query", key: "projectId" }],
      destination: "/chat/:threadId",
    };

    const chatV2BranchRewrites = [...chatLegacyBranchRewrites, chatPersonalThreadDeepLinkRewrite];

    const fullstackApiOrigin = process.env.FULLSTACK_E2E_API_ORIGIN;
    const apiOrigin = fullstackApiOrigin ?? process.env.CHAT_READ_E2E_API_ORIGIN;
    if (!apiOrigin) return { beforeFiles: chatV2BranchRewrites };
    const brokenFilesRoute = process.env.FULLSTACK_E2E_BREAK_CONTROLLER === "artifacts";
    const prefix = fullstackApiOrigin ? "/__fullstack_api" : "";

    // Browser E2E gates must traverse the real API; the test-only same-origin proxy
    // 跨端口 CORS 配置扩张成产品运行时改动。正式 `/chat` 页面本身不被改写。
    const afterFiles = [
      { source: `${prefix}/auth/:path*`, destination: `${apiOrigin}/auth/:path*` },
      { source: `${prefix}/identity/:path*`, destination: `${apiOrigin}/identity/:path*` },
      // F965：审计检索唯一面 `GET /provenance`（identity 与 artifact 两束共写、
      // provenance.controller.ts 唯一读端）。裸路径、无 `:path*`——同上面 `/capabilities`
      // `/blueprints` `/skills` 那个坑：这条路径此前**从未有过前端真实调用方**
      // （`lib/live-provenance.ts` 的 `queryProvenance` 在 F965 之前零调用点），所以
      // 缺这条 rewrite 一直没被撞到过。实测（F965 真栈截图取证，issue #1627）：缺了它，
      // 前端打到 Next 自己的 404 HTML，`成果沉淀 · 审计与反馈` 区显示
      // 「审计事件读取失败：HTTP 404」——看起来像后端没实现，实际是路由没接（与
      // `/blueprints`/`/messages` 那两条注释描述的同一类坑，只是这次真的踩上了）。
      { source: `${prefix}/provenance`, destination: `${apiOrigin}/provenance` },
      // #458：Agent 目录的读与写。`/capabilities` 自己是 GET 列表，`/capabilities/mutate`
      // 是写——两条都要写出来，`:path*` 匹配不到没有后缀的那一条。
      { source: `${prefix}/capabilities`, destination: `${apiOrigin}/capabilities` },
      { source: `${prefix}/capabilities/:path*`, destination: `${apiOrigin}/capabilities/:path*` },
      // #496：画布模板注册表的读与写。`/canvas/templates` 自己既是 GET 列表也是
      // POST 新建（两个方法一条路径），`:path*` 匹配不到没有后缀的那一条 ——
      // 与上面 `/capabilities` 逐字同一个坑，所以同样写两条。
      { source: `${prefix}/canvas/templates`, destination: `${apiOrigin}/canvas/templates` },
      { source: `${prefix}/canvas/:path*`, destination: `${apiOrigin}/canvas/:path*` },
      // F173（#991 BP-01）：蓝本的读与写。`/blueprints` 自己既是 GET 列表也是
      // POST 新建 —— 与上面 `/capabilities`、`/canvas/templates`、`/skills` 逐字
      // 同一个坑：`:path*` 匹配不到没有后缀的那一条，所以**两条都要写**。
      // 缺了裸路径那条，前端打到的是 Next 的 404 HTML，症状是
      // `Unexpected token '<'`（JSON.parse 到了 `<!DOCTYPE`），而不是一个像样的报错。
      { source: `${prefix}/blueprints`, destination: `${apiOrigin}/blueprints` },
      { source: `${prefix}/blueprints/:path*`, destination: `${apiOrigin}/blueprints/:path*` },
      // #520：Skill 目录的读与写。`/skills` 自己既是 GET 列表也是 POST 建草稿，
      // `/skills/:id` 与 `/skills/:id/disable` 走 `:path*` ——
      // **这是同一个坑的第三次**（前两次就写在上面 `/capabilities` 与
      // `/canvas/templates` 的注释里）。缺了裸路径那一条，`/skill` 前端会静默打到
      // Next 自己的 404 而不是 API，表现成「后端没实现」，而不是「路由没接」。
      { source: `${prefix}/skills`, destination: `${apiOrigin}/skills` },
      { source: `${prefix}/skills/:path*`, destination: `${apiOrigin}/skills/:path*` },
      // F176：消息级评价（`POST /messages/:messageId/rating`，F68 契约）。
      // ⚠ path 前缀是 `/messages` 而不是 `/chat/...`——契约把它挂在消息本身上，
      //   因为评价的主语是消息，而消息同时属于 chat（可见性）与 skills（归因）两束。
      //   少了这条 rewrite，前端拿到的是 Next 返回的 404 HTML，
      //   报错长成 `Unexpected token '<'`——一个看起来像 JSON 解析 bug 的路由缺失。
      { source: `${prefix}/messages/:path*`, destination: `${apiOrigin}/messages/:path*` },
      /**
       * #595：`/admin/*` —— 后台管理面（`/admin/skills/url-imports`、
       * `/admin/skills/starter-pack-imports`、`/admin/agents/starter-pack-imports` …）。
       *
       * ⚠ 这一条是**接 controller 时才发现必须补的**，发现方式值得记下来：
       *   `admin` 原本整个前缀都躺在 `rewrite-coverage-allowlist.json` 的棘轮名单里，
       *   ⇒ 门是**绿的**，而那个绿的含义是「这条缺口是已登记的历史债」，
       *   **不是**「前端够得到」。⇒ 新写的 `/admin/skills/url-imports` 从浏览器打过去
       *   会被 Next 自己接住返回 404 HTML，前端 `JSON.parse` 报
       *   `Unexpected token '<'`，看起来完全像「后端没实现」。
       *
       * ⚠ 这直接卡住 #595 的验收第 4 条（导入后能在 `/chat` 里选中并调用）——
       *   段 3 的前端根本发不出这个请求。所以补 rewrite 不是顺手整理，是前置条件。
       *
       * 🔴 ⚠⚠ **这里必须逐条写 `/admin/skills` 与 `/admin/agents`，绝不能图省事写
       *        `${prefix}/admin/:path*`。**
       *
       * 我第一版就是那么写的，实测发现它会**吃掉前端自己的页面**：
       *   · `apps/web/app/admin/page.tsx` 与 `app/admin/[module]/page.tsx` 是**真实前端路由**
       *     （`/admin/agent`、`/admin/skill`、`/admin/model`、`/admin/mcp`、`/admin/members` …，
       *     `core-loop.spec.ts:128` 与 `capability-mutate-smoke.spec.ts:51` 都在 `page.goto` 它们）；
       *   · `chat-read` 那套 e2e 的 `prefix` 是**空字符串**（只有 fullstack 那套才是
       *     `/__fullstack_api`）⇒ `${prefix}/admin/:path*` 会变成裸的 `/admin/:path*`，
       *     把上面那些**前端页面**整片代理到 API 去。
       *
       * ⚠ 之所以今天没炸，纯粹是**单复数不同**：前端是 `/admin/skill`、`/admin/agent`（单数），
       *   API 是 `/admin/skills/…`、`/admin/agents/…`（复数）。这是一条**很细的区别**，
       *   ⛔ 谁要加 `/admin` 下的新 API 路由，请先确认它不会撞上 `app/admin/[module]`
       *   那个动态段，并在这里**逐条**加，而不是放宽成通配。
       *
       * ⚠ 没有配裸 `${prefix}/admin/skills`：本仓当前没有 controller 注册裸的
       *   `/admin/skills`（只有 `/admin/skills/url-imports` 与
       *   `/admin/skills/starter-pack-imports`）。⛔ 哪天有了，必须同时补裸路径那一条——
       *   `:path*` 匹配不到没有后缀的那一条，这个坑本文件上面已经栽过三次。
       */
      { source: `${prefix}/admin/skills/:path*`, destination: `${apiOrigin}/admin/skills/:path*` },
      { source: `${prefix}/admin/agents/:path*`, destination: `${apiOrigin}/admin/agents/:path*` },
      // #552：双重门禁的三条路径（`/skill-versions/:versionId/security-scan|submit|review`）。
      // `SkillReviewController` 是 `@Controller()`（空前缀），所以路径是**裸的**
      // `/skill-versions/...`，**不在 `/skills/` 下面** —— 上面那条 `/skills/:path*`
      // 匹配不到它。少这一条不会失败在网络层，而是被 Next 自己接住返回 404 HTML，
      // 前端 `JSON.parse` 报 `Unexpected token '<'`，看起来像「后端没实现」。
      // **这是同一个坑的第六次**（前五次是 /capabilities、/canvas/templates、/skills、
      // /agent-runs、/recording，注释都还在上面）。裸 `/skill-versions` 今天没有任何
      // 操作命中，仍然写出来 —— 这正是 `/threads` 那条留下的教训。
      { source: `${prefix}/skill-versions`, destination: `${apiOrigin}/skill-versions` },
      { source: `${prefix}/skill-versions/:path*`, destination: `${apiOrigin}/skill-versions/:path*` },
      // F962：试跑异步轮询读，`GET /skill-trial-runs/:trialRunId`。`SkillTrialRunController`
      // 也是 `@Controller()`（空前缀），路径是裸的 `/skill-trial-runs/...`——**不在**
      // `/skill-versions/` 下面（提交 `POST .../trial-run` 挂在 `skill-versions` 下、
      // 结果轮询读挂在独立的裸路径下，两者前缀不共享，与上面 `/workshops` vs `/projects`
      // 同一种"同一件事两个路径空间"的形状）。**这是同一个坑的第 N+1 次**（本文件前面
      // 十几条注释都在讲同一件事：漏了裸路径不会失败在网络层，会被 Next 自己接住
      // 返回 404 **HTML**，前端表现成"查不到"而不是"路由没接"）。
      // 实测复现（2026-08-19/20，`skill-agent-import-usecase-audit.spec.ts` ③，issue #1608）：
      // 加了轮询逻辑后 GET 仍然稳定 404，一度怀疑是提交后短暂不可见的竞态——用
      // Playwright trace 网络快照核对响应体才发现 `mimeType: text/html`，是 Next 自己的
      // 404 页，不是 API 的 JSON 404。轮询逻辑本身没有问题，问题在这一条缺失的 rewrite。
      { source: `${prefix}/skill-trial-runs/:path*`, destination: `${apiOrigin}/skill-trial-runs/:path*` },
      // 实测（真栈 e2e，`skill-agent-import-usecase-audit.spec.ts` ②）——**这是同一个坑
      // 的第 N 次，且这次没有任何一条注释提前警告过**：`asset-directory.controller.ts`
      // 的五个端口（`GetAssetDirectory`/`ReadAssetFile`/`WriteAssetFile`/`DeleteAssetFile`/
      // `RenameAssetFile`，全部挂在 `/assets/:assetKind/:assetId/files...` 下）此前
      // 没有任何一条 rewrite。在这套「同源代理前缀」的浏览器门控下，`AgSkillEditor`
      // 打出去的每一次真实数据读写都被 Next 自己接住返回 404 HTML，`apiRequest` 的
      // `JSON.parse` 崩在 `<!DOCTYPE`，界面表现为「接口错误……已回退 mock」——
      // 症状与上面五次一模一样，只是这次连累的是 #848/#881 那条"文件浏览器 +
      // code editor"链路：它在任何走这套代理的环境里（包括这条 e2e 本身）从未真的
      // 读到过一次真实文件。不存在裸 `/assets` 路径，一条 `:path*` 够。
      { source: `${prefix}/assets/:path*`, destination: `${apiOrigin}/assets/:path*` },
      // #548：模型池。`/models` 裸路径是 POST 接入（**凭据进入系统的唯一入口**），
      // `/models/:id/admission-tests` 走 `:path*` —— **同一个坑的第七次**（含上面
      // `/skill-versions` 那条，这两条是同一天先后撞上的），前五次的注释就在本文件
      // 上下：/capabilities、/canvas/templates、/skills、/agent-runs、/recording。
      // 缺了裸路径那一条不会失败在网络层，而是被 Next 接住返回 404 **HTML**，
      // 前端读到的是「后端没实现」，查起来极贵。
      { source: `${prefix}/models`, destination: `${apiOrigin}/models` },
      { source: `${prefix}/models/:path*`, destination: `${apiOrigin}/models/:path*` },
      // `/model-calls` 的两条一并写下：`routeModelCall` / `assembleSystemPrompt` 尚未接线
      // （见 `model.controller.ts` 文件头），但前缀在这里缺位正是上面那个坑的复现条件，
      // 而 rewrite 指向一条不存在的后端路由只会得到后端自己的 404 JSON —— 那是**正确**
      // 的失败形态，比 Next 的 404 HTML 好查。
      // fb2（产品反馈闭环）：`feedback-loop.ts` 挂了 5 条 operation，裸路径 `/feedback`
      // 与 `/feedback/counts` 缺位是同一个坑的复现——见上面 `/models` 那条注释的完整
      // 论证，这里不重复：缺了裸路径不会失败在网络层，会被 Next 接住返回 404 HTML。
      { source: `${prefix}/feedback`, destination: `${apiOrigin}/feedback` },
      { source: `${prefix}/feedback/:path*`, destination: `${apiOrigin}/feedback/:path*` },
      // UC-17.8 B3.2（统一收件箱）：`inbox.ts` 挂了 `listInbox`（裸 `/inbox`）与
      // `getInboxCounts`（`/inbox/counts`）——同一个坑的复现，理由同上面 `/feedback` 那条。
      { source: `${prefix}/inbox`, destination: `${apiOrigin}/inbox` },
      { source: `${prefix}/inbox/:path*`, destination: `${apiOrigin}/inbox/:path*` },
      { source: `${prefix}/model-calls`, destination: `${apiOrigin}/model-calls` },
      { source: `${prefix}/model-calls/:path*`, destination: `${apiOrigin}/model-calls/:path*` },
      // issue #2664（异步子任务派发）：`subtask-run.controller.ts` 挂了
      // `POST /internal/subtask-runs`——deep-agent-service 用它回调子任务结果。
      // 同一个坑的又一次复现：缺了这条，`lint-rewrite-coverage.mjs --strict` 判定
      // 这条 controller 路由前端够不到（会被 Next 接住返回 404 HTML）。
      { source: `${prefix}/internal/:path*`, destination: `${apiOrigin}/internal/:path*` },
      // #466：recording controller（#465 暴露）。**这是同一个坑的第五次** ——
      // 前四次分别是 /capabilities、/canvas/templates、/skills、/agent-runs，
      // 注释都还在上面。缺了这条，`/recording/sessions` 不会失败在网络层，
      // 而是被 Next 自己接住返回 404 HTML，前端拿到 `Unexpected token '<'`，
      // 表现成「后端没实现」而不是「路由没接」。
      // recording 的路径永远带后缀（/sessions、/sessions/:id/segments …），
      // 没有裸路径那一条，所以这里只需要 `:path*`。
      { source: `${prefix}/recording/:path*`, destination: `${apiOrigin}/recording/:path*` },
      // issue #652：`FilesRetentionController` 是 `@Controller()`（空前缀），GET/PUT
      // 都打同一个裸路径 `/retention-policy`（无子路径、无 `:path*` 可用）——
      // 与上面 `/capabilities`、`/canvas/templates` 那几条同一个坑：不写这条，
      // `startRecording` 前置的“配置保留期”从浏览器根本发不出请求，会被 Next 自己
      // 接住返回 404 HTML，而不是 API 的 403/422。
      { source: `${prefix}/retention-policy`, destination: `${apiOrigin}/retention-policy` },
      // Phase 04 Interview Studio：集合路由承载历史列表，子路由承载专家与快捷访谈。
      // 两条都需要，否则 Next 会把请求接成 404 HTML，客户端表现为 Unexpected token '<'。
      { source: `${prefix}/interviews`, destination: `${apiOrigin}/interviews` },
      { source: `${prefix}/interviews/:path*`, destination: `${apiOrigin}/interviews/:path*` },
      // ⚠ 2026-08-25（issue #2021 实测抓到）：这里原来是一条 `/chat/:path*` 兜底——
      // Next 的 afterFiles rewrites 在**动态路由之前**匹配（官方文档明写的顺序：
      // afterFiles = after pages/public files, BEFORE dynamic routes），于是新增的
      // `/chat/copilotkit-v2/[threadId]` 页面永远轮不到：整页刷新拿到的是 API 的
      // `{"error":"not_found"}` JSON 文档。静态路由（`/chat/copilotkit-v2` 裸段）
      // 不受影响，这就是"发消息正常、刷新即坏"这个形态的全部成因——也是该 spec
      // 此前从未绿过的真根因（不是机器负载）。收窄为 API 侧真实存在的 9 个
      // `/chat/*` 命名空间（grep controllers 实测清单），每个裸路径 + `:path*`
      // 双条目（`/capabilities`/#458 同一个坑的同一个解法）。
      // issue #2090：上面这份枚举是「grep controllers 实测清单」——`AsrDraftGateway`
      // 是 `WS @WebSocketGateway`，不是 `@Controller()`，没被那次 grep 扫到，
      // `/chat/asr-draft` 漏出了枚举表。浏览器发起的 `WS /chat/asr-draft` 握手落在
      // Next dev 自己身上（没有这个路由），`waitForSocketOpen` 走 error 分支 reject，
      // composer 麦克风表现为"点了没反应，紧接着报『无法启动语音识别，请重试』"。
      ...[
        "approval-requests", "artifacts", "citations", "messages", "presets",
        "projects", "tasks", "threads", "visibility", "asr-draft",
      ].flatMap((ns) => [
        { source: `${prefix}/chat/${ns}`, destination: `${apiOrigin}/chat/${ns}` },
        { source: `${prefix}/chat/${ns}/:path*`, destination: `${apiOrigin}/chat/${ns}/:path*` },
      ]),
      // #467：对话内临时挂载 skill。`SkillMountController` 是 `@Controller()`（空前缀），
      // 路径就是裸的 `/threads/:threadId/skill-mounts` 与 `/threads/:threadId/skill-deviations`
      // —— **不在 `/chat/` 下面**，与下面 `/agent-runs` 同一个形状。
      // 裸 `/threads` 那一条今天没有任何操作命中，仍然写出来：这是 `/capabilities`、
      // `/canvas/templates`、`/skills` 三次踩过的同一个坑，缺了它，将来有人加一条
      // `GET /threads` 时会得到 Next 自己的 404 HTML 而不是 API 的响应。
      { source: `${prefix}/threads`, destination: `${apiOrigin}/threads` },
      { source: `${prefix}/threads/:path*`, destination: `${apiOrigin}/threads/:path*` },
      // #435：AgentRun 的轮询读。**它不在 `/chat/` 下面** —— `AgentRunController` 是
      // `@Controller()`（空前缀），路径就是裸的 `/agent-runs/:runId`
      // （`apps/api/src/interface/controllers/agent-run.controller.ts:35`）。
      //
      // 漏了这一条的表现极具误导性：请求不会失败在网络层，而是被 Next 自己接住返回
      // **404 的 HTML**，前端 `JSON.parse` 于是报 `Unexpected token '<', "<!DOCTYPE "`。
      // 界面上看起来像「AgentRun 读不出来」，实际上 run 在服务端跑得好好的 ——
      // 实测就是这么红了一次（步骤 8b，2026-08-05）。
      { source: `${prefix}/agent-runs/:path*`, destination: `${apiOrigin}/agent-runs/:path*` },
      // #654 阶段1b：AG-UI SSE 桥接端点。`CopilotkitAguiController` 是 `@Controller()`
      // （空前缀），路径是裸的 `POST /copilotkit/agui` —— 与上面 `/agent-runs`、
      // `/threads` 同一个形状、同一个坑（第九次）。`lint-rewrite-coverage` 已经把这条
      // 标红（`.harness/scripts/lint-rewrite-coverage.mjs` 实测：不补这条，
      // `init.sh` 基础验证本身就红），不是新引入的探测，是补一个已存在的真实缺口。
      { source: `${prefix}/copilotkit/:path*`, destination: `${apiOrigin}/copilotkit/:path*` },
      // #595 Line A：`POST /agents/:agentId/trial-run`。`AgentTrialRunController` 是
      // `@Controller()`（空前缀），路径是裸的 `/agents/:agentId/trial-run` ——
      // 与上面 `/agent-runs` 同一个形状，同一个坑（第七次）。
      // #617：这里就是上面那条注释预告的「将来加一条裸 `POST /agents`」——
      // `createAgent`（`AgentController`）现在挂了裸的 `POST /agents`，
      // `listAgents`（`GET /agents`，仍未接线）将来也落在同一条裸路径上。
      // 补上裸路径这一条，不能只靠 `:path*` 兜底（同一个坑的第八次）。
      { source: `${prefix}/agents`, destination: `${apiOrigin}/agents` },
      { source: `${prefix}/agents/:path*`, destination: `${apiOrigin}/agents/:path*` },
      { source: `${prefix}/projects`, destination: `${apiOrigin}/projects` },
      { source: `${prefix}/projects/:projectId/artifacts`, destination: brokenFilesRoute
        ? `${apiOrigin}/__broken/projects/:projectId/artifacts`
        : `${apiOrigin}/projects/:projectId/artifacts` },
      { source: `${prefix}/projects/:path*`, destination: `${apiOrigin}/projects/:path*` },
      // #853 实测发现：议程环节三条路由（`createAgendaSegment`/`listAgendaSegments`/
      // `advanceAgendaSegment`，`project.controller.ts` 逐字）都挂在 `/workshops` 前缀下，
      // 不是 `/projects` 前缀——超类型模型下 `workshops.id ≡ projects.id`，但**路径前缀
      // 不共享**（同一件事在 URL 层面被处理成了两个空间）。这一条此前**完全缺失**：
      // #627 补齐 `createAgendaSegment` 的 controller 那次没人从浏览器真的打过它，
      // 缺口一直不可见——直到 #853 写 `agenda-segment-create-smoke.spec.ts` 第一次
      // 让浏览器真的发一次 `POST /workshops/...`，同源代理直接把它 404 成一页 HTML
      // （`apiRequest` 把 `<!DOCTYPE ...` 当 JSON 解析失败，界面上显示成一句读取失败）。
      // 少了这一条，`/workshops/*` 下任何一条契约操作在**任何**走同源代理部署的产品里
      // 都打不到后端，不只是本地 e2e。
      { source: `${prefix}/workshops/:path*`, destination: `${apiOrigin}/workshops/:path*` },
      // 引导式研究的历史集合与全部检查点共享 `/research` 前缀。
      // 两条都必须存在：集合列表/创建命中裸路径，恢复、方向与大纲命中深路径。
      { source: `${prefix}/research`, destination: `${apiOrigin}/research` },
      { source: `${prefix}/research/:path*`, destination: `${apiOrigin}/research/:path*` },
      { source: `${prefix}/artifacts/:path*`, destination: `${apiOrigin}/artifacts/:path*` },
      { source: `${prefix}/artifact-versions/:path*`, destination: `${apiOrigin}/artifact-versions/:path*` },
      { source: `${prefix}/artifact-aliases/:path*`, destination: `${apiOrigin}/artifact-aliases/:path*` },
      { source: `${prefix}/export-jobs/:path*`, destination: `${apiOrigin}/export-jobs/:path*` },
      // #363：组织管理面。`OrgInviteController` 与 `OrgAdminManagementController` 都是
      // `@Controller()`（空前缀），完整路径写在方法上：`/organizations/:orgId/invites`、
      // `…/invites/:inviteId/{review,resend,revoke}`、`…/teams`、`…/members/:userId/remove`。
      //
      // ⚠ 裸 `/organizations` 那一条今天没有任何操作命中，仍然写出来 —— 这是
      //   `/capabilities`、`/canvas/templates`、`/skills` 三次踩过的同一个坑：
      //   缺了它，将来有人加一条 `GET /organizations`（列组织）时拿到的是 Next 自己的
      //   404 HTML，前端报 `Unexpected token '<'`，看起来像「后端没实现」。
      //   `apps/web` 下**没有** `/organizations` 页面（`app/org-admin` 才是那个界面），
      //   所以这两条改写不遮挡任何前端路由。
      // ⚠ 补上之后必须把 `.harness/state/rewrite-coverage-allowlist.json` 里的
      //   `organizations` 删掉：棘轮名单只能变短，留着一条已补好的豁免
      //   等于给未来的回归留一扇没人看守的门（`lint-rewrite-coverage` 会报陈旧并变红）。
      { source: `${prefix}/organizations`, destination: `${apiOrigin}/organizations` },
      { source: `${prefix}/organizations/:path*`, destination: `${apiOrigin}/organizations/:path*` },
      // invite-link-and-reads delta ①：激活落地页 `/auth/activate` 现在真的会打
      // `POST /org-invites/activate`（此前该前缀只有 API、没有前端调用方，挂在
      // #539 棘轮名单里）。补上改写并从 `.harness/state/rewrite-coverage-allowlist.json`
      // 删掉 `org-invites`——棘轮只能变短。裸前缀一条同样写出来（同上
      // `/organizations` 的第四次同坑说明）；`apps/web` 没有 `/org-invites` 页面，
      // 不遮挡任何前端路由。
      { source: `${prefix}/org-invites`, destination: `${apiOrigin}/org-invites` },
      { source: `${prefix}/org-invites/:path*`, destination: `${apiOrigin}/org-invites/:path*` },
      // F977：`PlanControlController` 是 `@Controller()`（空前缀），路径是裸的
      // `GET /plan-control/threads/:threadId/ledger` —— 与上面 `/agent-runs`、
      // `/threads`、`/copilotkit` 同一个形状、同一个坑（lint-rewrite-coverage 实测
      // 标红：不补这条，Next 会把请求接成 404 HTML 而不是 API 的响应）。
      // 只有一个子路径、没有裸集合路由，只需要 `:path*`。
      { source: `${prefix}/plan-control/:path*`, destination: `${apiOrigin}/plan-control/:path*` },
      // #2490：phase-02 任务看板（`board.controller.ts`，`@Controller()` 空前缀）挂的是裸的
      // `GET/POST /tasks`、`GET /tasks/today`、`PATCH /tasks/:id/status`——**不在 `/chat/` 下面**
      // （上面枚举表里的 `chat/tasks` 是另一个命名空间），与 `/agents`、`/projects` 同一个形状：
      // 裸路径 + `:path*` 双条目缺一不可。`lint-rewrite-coverage` 自 08-31 起在 main 上一直
      // 标红这两条，只是那道门当时不在 PR 门控上（见 #2490）。`apps/web/app/tasks` 页面存在，
      // 但这里是 `afterFiles`，文件系统路由先命中，与 `/projects` 页面并存的方式相同。
      { source: `${prefix}/tasks`, destination: `${apiOrigin}/tasks` },
      { source: `${prefix}/tasks/:path*`, destination: `${apiOrigin}/tasks/:path*` },
      // #2490 / #2444：系统异常入库的读写面（`system-error-log.controller.ts`，空前缀）：
      // `GET /system/error-logs`、`POST /system/client-error-reports`。没有裸 `/system` 路由，
      // 同 `plan-control` 先例只补 `:path*`。
      { source: `${prefix}/system/:path*`, destination: `${apiOrigin}/system/:path*` },
    ];
    return { beforeFiles: chatV2BranchRewrites, afterFiles };
  },
};
