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
      { source: `${prefix}/model-calls`, destination: `${apiOrigin}/model-calls` },
      { source: `${prefix}/model-calls/:path*`, destination: `${apiOrigin}/model-calls/:path*` },
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
    ];
  },
};
