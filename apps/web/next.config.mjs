/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  eslint: { dirs: ["app", "components", "lib"] },
  // 生产门控校验用独立的 dist 目录：否则 `next dev` 与 `next build` 争抢 .next，
  // 会出现 "Cannot find module ./vendor-chunks/..." 这类假故障。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    const fullstackApiOrigin = process.env.FULLSTACK_E2E_API_ORIGIN;
    const apiOrigin = fullstackApiOrigin ?? process.env.CHAT_READ_E2E_API_ORIGIN;
    if (!apiOrigin) return [];
    const brokenFilesRoute = process.env.FULLSTACK_E2E_BREAK_CONTROLLER === "artifacts";
    const prefix = fullstackApiOrigin ? "/__fullstack_api" : "";

    // Browser E2E gates must traverse the real API; the test-only same-origin proxy
    // 跨端口 CORS 配置扩张成产品运行时改动。正式 `/chat` 页面本身不被改写。
    return [
      { source: `${prefix}/auth/:path*`, destination: `${apiOrigin}/auth/:path*` },
      { source: `${prefix}/identity/:path*`, destination: `${apiOrigin}/identity/:path*` },
      // #458：Agent 目录的读与写。`/capabilities` 自己是 GET 列表，`/capabilities/mutate`
      // 是写——两条都要写出来，`:path*` 匹配不到没有后缀的那一条。
      { source: `${prefix}/capabilities`, destination: `${apiOrigin}/capabilities` },
      { source: `${prefix}/capabilities/:path*`, destination: `${apiOrigin}/capabilities/:path*` },
      // #496：画布模板注册表的读与写。`/canvas/templates` 自己既是 GET 列表也是
      // POST 新建（两个方法一条路径），`:path*` 匹配不到没有后缀的那一条 ——
      // 与上面 `/capabilities` 逐字同一个坑，所以同样写两条。
      { source: `${prefix}/canvas/templates`, destination: `${apiOrigin}/canvas/templates` },
      { source: `${prefix}/canvas/:path*`, destination: `${apiOrigin}/canvas/:path*` },
      // #520：Skill 目录的读与写。`/skills` 自己既是 GET 列表也是 POST 建草稿，
      // `/skills/:id` 与 `/skills/:id/disable` 走 `:path*` ——
      // **这是同一个坑的第三次**（前两次就写在上面 `/capabilities` 与
      // `/canvas/templates` 的注释里）。缺了裸路径那一条，`/skill` 前端会静默打到
      // Next 自己的 404 而不是 API，表现成「后端没实现」，而不是「路由没接」。
      { source: `${prefix}/skills`, destination: `${apiOrigin}/skills` },
      { source: `${prefix}/skills/:path*`, destination: `${apiOrigin}/skills/:path*` },
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
       * ⚠ 没有配裸 `${prefix}/admin`：本仓当前**没有任何 controller 注册裸 `/admin`**
       *   （实测六个方法装饰器 `@Get("/admin")` … 零命中）。
       *   ⛔ 哪天有人加了一条裸 `/admin`，必须同时在这里补裸路径那一条——
       *   `:path*` 匹配不到没有后缀的那一条，这个坑本文件上面已经栽过三次。
       */
      { source: `${prefix}/admin/:path*`, destination: `${apiOrigin}/admin/:path*` },
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
      // #466：recording controller（#465 暴露）。**这是同一个坑的第五次** ——
      // 前四次分别是 /capabilities、/canvas/templates、/skills、/agent-runs，
      // 注释都还在上面。缺了这条，`/recording/sessions` 不会失败在网络层，
      // 而是被 Next 自己接住返回 404 HTML，前端拿到 `Unexpected token '<'`，
      // 表现成「后端没实现」而不是「路由没接」。
      // recording 的路径永远带后缀（/sessions、/sessions/:id/segments …），
      // 没有裸路径那一条，所以这里只需要 `:path*`。
      { source: `${prefix}/recording/:path*`, destination: `${apiOrigin}/recording/:path*` },
      { source: `${prefix}/chat/:path*`, destination: `${apiOrigin}/chat/:path*` },
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
      { source: `${prefix}/projects`, destination: `${apiOrigin}/projects` },
      { source: `${prefix}/projects/:projectId/artifacts`, destination: brokenFilesRoute
        ? `${apiOrigin}/__broken/projects/:projectId/artifacts`
        : `${apiOrigin}/projects/:projectId/artifacts` },
      { source: `${prefix}/projects/:path*`, destination: `${apiOrigin}/projects/:path*` },
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
    ];
  },
};
