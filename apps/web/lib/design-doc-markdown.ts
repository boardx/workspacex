/**
 * UC-17.8 B5.3 —— 把一个设计项目导出成**设计文档**（Markdown）。
 *
 * 纯函数：输入契约 `DesignProject`，输出一段 Markdown 文本；下载/复制由调用方做。
 * 内容顺序 = 详情页右侧的阅读顺序（问题与目标 → 验收标准 → 原型逐页大纲 → 对话摘录）。
 * 原型部分是组件树的**缩进大纲**，不是 JSON dump：给工程/评审看的是结构与文案，
 * 树的原始 JSON 由 `DesignProject.prototype` 本身承载，不在文档里再复制一份。
 */
import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/messages";
import { projectTemplateDisplayLabel, prototypeOptionDisplayLabel, prototypeNodeDisplayLabel, designAccentDisplayLabel } from "./design-display-labels";
import { designHtmlPage, designPrototype } from "@repo/contracts";
import { exportFileStem, type Romanize } from "./export-file-name";
import { localDateStamp, localTimeStamp } from "./prototype-export-html";
import type { DesignProject, PrototypeNode } from "./live-design-workbench";

const { isPrototypeContainer } = designPrototype;

/**
 * 迭代 38 —— 大纲里的枚举取值说人话。
 *
 * 这份文档自己的注释写着「文档的读者是人」（迭代 11 为跳转清单写的），而同一份文档里
 * 一直印着 `文本（title）`、`按钮「发送」（primary）`、`图片（photo）`、`（图标 cart）`——
 * 那是 schema 的字面量。第 5 轮已经为属性面板建好了单源 `prototypeOptionLabel`
 * （契约里，且有覆盖率门控），这里直接用，不另抄一份中文。
 */
const opt = (locale: Locale, type: string, key: string, value: string | undefined): string | undefined =>
  value === undefined ? undefined : prototypeOptionDisplayLabel(type, key, value, locale);

/** 一个节点在大纲里的一行文字：类型 + 最能代表它的文案。 */
export function describeNode(n: PrototypeNode, locale: Locale = "zh-CN"): string {
  switch (n.type) {
    case "stack": return translate(locale, "designDocument.layout", { v0: n.props?.direction === "row" ? translate(locale, "designDocument.horizontal") : translate(locale, "designDocument.vertical"), v1: n.props?.fill === true ? translate(locale, "designDocument.fill") : "" });
    case "card": return n.props?.title !== undefined ? translate(locale, "designDocument.card2", { v0: n.props.title }) : translate(locale, "designDocument.card");
    case "navbar": return translate(locale, "designDocument.navigation2", { v0: n.props.title, v1: n.props.left !== undefined ? translate(locale, "designDocument.left", { v0: n.props.left }) : "", v2: n.props.right !== undefined ? translate(locale, "designDocument.right", { v0: n.props.right }) : "" });
    case "text": return translate(locale, "designDocument.text2", { v0: n.props.variant !== undefined ? `（${opt(locale, "text", "variant", n.props.variant)!}）` : "", v1: n.props.content });
    // 迭代 21：图标是**设计决定**，工程照着实现时要知道按哪个图标。此前 describeNode
    // 不提它，于是这条信息在交付文档里凭空消失。
    case "button": return translate(locale, "designDocument.button2", { v0: n.props.label, v1: n.props.icon !== undefined ? translate(locale, "designDocument.icon", { v0: opt(locale, "button", "icon", n.props.icon)! }) : "", v2: n.props.variant !== undefined ? `（${opt(locale, "button", "variant", n.props.variant)!}）` : "" });
    case "input": return translate(locale, "designDocument.input", { v0: n.props.label !== undefined ? `「${n.props.label}」` : "", v1: n.props.placeholder !== undefined ? translate(locale, "designDocument.placeholder", { v0: n.props.placeholder }) : "", v2: n.props.multiline === true ? translate(locale, "designDocument.multiline") : "" });
    case "image": return translate(locale, "designDocument.image", { v0: opt(locale, "image", "kind", n.props.kind ?? "photo")!, v1: n.props.alt });
    /**
     * 迭代 21 —— 列表行的**副标题与右侧值不能丢**。
     *
     * 前面几轮给 `list` 加了 `detail`（副标题）/ `trailing`（右侧值）/ `icons`，画布渲染
     * 了、导出的 HTML 渲染了，而这份交付文档只写 `items`——于是「店名 / 三件商品 / ¥128」
     * 到了工程手里只剩「店名」。工程照着文档实现，根本不知道那两列存在。
     *
     * 这是我自己在前几轮造成的洞，而且是本仓反复点名的那一类：**一处加了数据，
     * 下游少了一处跟进，界面上有、交付物里没有**。所以三段式在这里也写成三段式。
     */
    case "list": {
      const rows = n.props.items.map((item, i) => {
        const detail = n.props.detail?.[i]?.trim();
        const trailing = n.props.trailing?.[i]?.trim();
        const icon = n.props.leading === "icon" && n.props.icons?.[i] !== undefined ? `[${opt(locale, "list", "icons", n.props.icons[i]!) ?? n.props.icons[i]!}] ` : "";
        return icon + item
          + (detail !== undefined && detail !== "" ? `（${detail}）` : "")
          + (trailing !== undefined && trailing !== "" ? ` → ${trailing}` : "");
      });
      return translate(locale, "designDocument.list", { v0: rows.join(" / ") });
    }
    case "divider": return translate(locale, "designDocument.divider");
    case "spacer": return translate(locale, "designDocument.spacer");
    case "tabs": return translate(locale, "designDocument.tabs", { v0: n.props.items.map((t, i) => (i === (n.props.active ?? 0) ? `[${t}]` : t)).join(" / ") });
    case "badge": return translate(locale, "designDocument.badge", { v0: n.props.label });
    case "avatar": return translate(locale, "designDocument.avatar", { v0: n.props.name });
    case "bottomnav": return translate(locale, "designDocument.bottomNavigation", { v0: n.props.items.map((t, i) => (i === (n.props.active ?? 0) ? `[${t}]` : t)).join(" / ") });
    case "switch": return translate(locale, "designDocument.switch", { v0: n.props.label, v1: n.props.on === true ? translate(locale, "designDocument.on") : translate(locale, "designDocument.off") });
    case "checkbox": return translate(locale, "designDocument.checkbox", { v0: n.props.label, v1: n.props.checked === true ? translate(locale, "designDocument.checked") : "" });
    case "chip": return translate(locale, "designDocument.filter", { v0: n.props.label, v1: n.props.selected === true ? translate(locale, "designDocument.selected") : "" });
    case "progress": return translate(locale, "designDocument.progress", { v0: n.props.value, v1: n.props.label !== undefined ? `：${n.props.label}` : "" });
    case "stat": return translate(locale, "designDocument.metric", { v0: n.props.label, v1: n.props.value, v2: n.props.delta !== undefined ? `（${n.props.delta}）` : "" });
    case "hero": return translate(locale, "designDocument.hero", { v0: n.props.title, v1: n.props.subtitle !== undefined ? `：${n.props.subtitle}` : "", v2: n.props.cta !== undefined ? translate(locale, "designDocument.button", { v0: n.props.cta }) : "" });
    // 对标 R3：表格与图表把**数据**写进文档，工程拿到的是样例数据而不是「这里有张表」。
    case "table": return translate(locale, "designDocument.tableRows", { v0: n.props.columns.join(" / "), v1: n.props.rows.length, v2: n.props.rows[0] !== undefined ? translate(locale, "designDocument.firstRow", { v0: n.props.rows[0].join(" / ") }) : "" });
    case "chart": return `${n.props.kind === "line" ? translate(locale, "designDocument.lineChart") : translate(locale, "designDocument.barChart")}${n.props.title !== undefined ? `「${n.props.title}」` : ""}：${n.props.labels.slice(0, n.props.values.length).map((l, i) => `${l} ${String(n.props.values[i])}${n.props.unit ?? ""}`).join("，")}`;
    // design-delta `prototype-board`：把画布上写了什么、谁连着谁说全——工程据此判断要做的是白板 / 流程图。
    case "html": return translate(locale, "designDocument.fullPageFreeLayout", { v0: designHtmlPage.htmlPageVisibleText(n.props.html) });
    case "board": {
      const items = n.props.items.map((it) => `${it.kind === "sticky" ? translate(locale, "designDocument.stickyNote") : it.kind === "shape" ? translate(locale, "designDocument.shape") : translate(locale, "designDocument.text")}「${it.text}」${it.author !== undefined ? `（${it.author}）` : ""}`);
      const links = (n.props.links ?? []).filter((l) => l.from < n.props.items.length && l.to < n.props.items.length)
        .map((l) => `「${n.props.items[l.from]!.text}」→「${n.props.items[l.to]!.text}」${l.label !== undefined ? `（${l.label}）` : ""}`);
      const cursors = (n.props.cursors ?? []).map((c) => c.name);
      return translate(locale, "designDocument.freeCanvas", { v0: items.join("、") || translate(locale, "designDocument.empty"), v1: links.length > 0 ? translate(locale, "designDocument.links", { v0: links.join("，") }) : "", v2: cursors.length > 0 ? translate(locale, "designDocument.collaborating", { v0: cursors.join("、") }) : "" });
    }
    // 对标 R4：表单项把选项写全，叠层说清是哪种（工程据此决定是 Dialog 还是 Sheet）。
    // 对标 R5
    case "section": return translate(locale, "designDocument.section", { v0: n.props?.tone === "muted" ? translate(locale, "designDocument.mutedBackground") : n.props?.tone === "primary" ? translate(locale, "designDocument.primaryBackground") : n.props?.tone === "inverse" ? translate(locale, "designDocument.inverseBackground") : translate(locale, "designDocument.noBackground") });
    case "footer": return translate(locale, "designDocument.footer", { v0: n.props.brand, v1: n.props.links !== undefined && n.props.links.length > 0 ? `：${n.props.links.join(" / ")}` : "", v2: n.props.note !== undefined ? `；${n.props.note}` : "" });
    case "select": return translate(locale, "designDocument.select", { v0: n.props.label !== undefined ? `「${n.props.label}」` : "", v1: n.props.options.join(" / "), v2: n.props.value !== undefined ? translate(locale, "designDocument.current", { v0: n.props.value }) : "" });
    case "radio": return translate(locale, "designDocument.radio", { v0: n.props.label !== undefined ? `「${n.props.label}」` : "", v1: n.props.options.map((o, i) => (i === n.props.selected ? `●${o}` : o)).join(" / ") });
    case "overlay": return `${n.props?.kind === "sheet" ? translate(locale, "designDocument.bottomSheet") : n.props?.kind === "toast" ? translate(locale, "designDocument.toast") : translate(locale, "designDocument.dialog")}${n.props?.title !== undefined ? `「${n.props.title}」` : ""}`;
    case "grid": return translate(locale, "designDocument.gridColumns", { v0: n.props?.columns ?? 2 });
  }
}

export function outlinePrototype(root: PrototypeNode, depth = 0, out: string[] = [], locale: Locale = "zh-CN"): string[] {
  out.push(`${"  ".repeat(depth)}- ${describeNode(root, locale)}`);
  if (isPrototypeContainer(root)) for (const c of root.children) outlinePrototype(c, depth + 1, out, locale);
  return out;
}

export function buildDesignDocMarkdown(project: DesignProject, now: Date = new Date(), locale: Locale = "zh-CN"): string {
  const lines: string[] = [];
  lines.push(`# ${project.name}`, "");
  /*
   * 迭代 21：**视觉设定进文档**。模板（含保真度）、明暗、强调色都是工程要照着实现的
   * 设计决定；此前文档只写模板名，拿到文档的人不知道这稿是按哪个主色定的。
   */
  lines.push(translate(locale, "designDocument.template", { v0: projectTemplateDisplayLabel(project.template, locale), v1: project.template === "wireframe" ? translate(locale, "designDocument.lowFidelityWireframeInformationDoesNotRelyOnColor") : "" }));
  lines.push(translate(locale, "designDocument.appearanceAccent", { v0: project.theme === "light" ? translate(locale, "designDocument.light") : translate(locale, "designDocument.dark"), v1: designAccentDisplayLabel(project.accent, locale) }));
  lines.push(translate(locale, "designDocument.designParameters", { v0: JSON.stringify(project.tokens) }));
  lines.push(translate(locale, "designDocument.designUpdatedAt", { v0: project.updatedAt }));
  lines.push(translate(locale, "designDocument.owner", { v0: project.ownerName ?? translate(locale, "designDocument.unknown") }));
  if (project.linkedFeedbackId !== null) lines.push(translate(locale, "designDocument.sourceFeedback", { v0: project.linkedFeedbackId }));
  if (project.githubIssueUrl !== null) lines.push(translate(locale, "designDocument.developmentIssue", { v0: project.githubIssueUrl }));
  /*
   * 迭代 38：原来是 `now.toISOString()`——文档里印着 `2026-09-07T12:00:00.000Z`。
   * 这是给人读的交付文档，而那串东西既不是读者所在时区的时间，也不像个时间。
   */
  lines.push(translate(locale, "designDocument.exportedAt", { v0: localTimeStamp(now) }), "");
  lines.push(translate(locale, "designDocument.problemAndGoals"), "", project.problem.trim() === "" ? translate(locale, "designDocument.notWrittenYet") : project.problem, "");
  // Legacy projects may already contain only the last AI edit summary. The
  // first persisted user request remains authoritative source material.
  const originalRequest = project.chat.find((turn) => turn.role === "user" && turn.text.trim())?.text.trim();
  if (originalRequest && !project.problem.includes(originalRequest)) {
    lines.push(`${translate(locale, "designDocument.requester")}：`, "", ...originalRequest.split("\n").map((line) => `> ${line}`), "");
  }
  if (project.pushNote?.trim()) lines.push(translate(locale, "designDocument.developmentHandoffNotes"), "", project.pushNote, "");
  lines.push(translate(locale, "designDocument.acceptanceCriteria"), "");
  if (project.criteria.length === 0) lines.push(translate(locale, "designDocument.noneYet"));
  for (const [i, c] of project.criteria.entries()) lines.push(`${i + 1}. ${c}`);
  if (project.refImages.length > 0) {
    lines.push("", translate(locale, "designDocument.referenceImages"), "");
    for (const image of project.refImages) lines.push(`- ${image.name}（${image.id}）`);
  }
  lines.push("", translate(locale, "designDocument.prototype"), "");
  if (project.prototype.length === 0) {
    lines.push(translate(locale, "designDocument.noPrototypeGeneratedYetPages", { v0: project.frames.join("、") || translate(locale, "designDocument.none") }));
  } else {
    for (const [i, root] of project.prototype.entries()) {
      lines.push(translate(locale, "designDocument.page2", { v0: i + 1, v1: project.frames[i] ?? "" }), "");
      // 迭代 8：每页交互说明先于结构大纲——工程先读「这页做什么」再看「里面有什么」。
      const note = (project.frameNotes[i] ?? "").trim();
      if (note !== "") lines.push(`> ${note.replace(/\n+/g, " ")}`, "");
      // issue #3340：没画出来的页**如实写出来**，不静默跳过——文档少一页而不说，
      // 读者会以为设计就是这么定的。
      if (root === null) lines.push(translate(locale, "designDocument.thisPageWasPlannedButNotRenderedGenerationFailed"), "");
      else lines.push(...outlinePrototype(root, 0, [], locale), "");
      // 迭代 11：这页点了之后去哪。工程照着实现路由，所以写成「哪个控件 → 第几页（标签）」，
      // 不是裸的节点 id——文档的读者是人。
      const links = project.frameLinks?.[i] ?? [];
      if (links.length > 0) {
        lines.push(translate(locale, "designDocument.navigation"), "");
        for (const l of links) {
          const node = designPrototype.findPrototypeNodePath(project.prototype, l.from);
          const label = node === null ? l.from : prototypeNodeDisplayLabel(node.path[node.path.length - 1]!, locale);
          const item = l.item === undefined ? "" : translate(locale, "designDocument.item", { v0: l.item + 1 });
          lines.push(translate(locale, "designDocument.page", { v0: label, v1: item, v2: l.to + 1, v3: project.frames[l.to] ?? "" }));
        }
        lines.push("");
      }
    }
  }
  const aiTurns = project.chat.filter((t) => t.role === "user").length;
  lines.push(translate(locale, "designDocument.designProcessConversationExcerpts"), "");
  if (project.chat.length === 0) lines.push(translate(locale, "designDocument.noConversation"));
  else {
    lines.push(translate(locale, "designDocument.roundsInTotal", { v0: aiTurns }), "");
    // 迭代 38：提需求的人未必是 PM——这一整轮迭代的前提就是「不做设计的人也能做原型」。
    for (const t of project.chat) lines.push(`- ${t.role === "user" ? translate(locale, "designDocument.requester") : "AI"}：${t.text.replace(/\s+/g, " ").trim()}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * 文件名：项目名里只保留 ASCII 字母数字与 `-_`，其余（含中文）去掉，+ 日期。
 * 迭代 10 e2e 实测：Chromium 对 `download` 属性里的非 ASCII 名会退回默认的「download」，中文名等于没名。
 * 中文项目名 ⇒ `design-<日期>`；文件内容里项目名仍是原文。
 */
export function designDocFileName(project: DesignProject, now: Date = new Date(), romanize?: Romanize | null): string {
  const safe = exportFileStem(project.name, "design", romanize);
  /*
   * 迭代 38：**第 14 轮只修了 HTML 那一处**，同一个 UTC 日期 bug 就在隔壁这一行里。
   * 东八区凌晨导出，文档文件名写的是昨天。单源在 `prototype-export-html.ts`。
   */
  return `${safe}-${localDateStamp(now)}.md`;
}

/**
 * 迭代 8：原型规格 JSON——给工程/别的工具吃的机器可读版本：页标签、每页交互说明、组件树（带 id）。
 * 不含对话与验收（那些在设计文档里）；`version` 是这份格式的版本号，不是项目版本。
 */
export function buildPrototypeSpecJson(project: DesignProject): string {
  const screens = project.frames.map((frame, i) => ({
    frame,
    notes: project.frameNotes[i] ?? "",
    root: project.prototype[i] ?? null,
    // 迭代 11：跳转关系随规格一起出——下游要照它接路由。
    links: project.frameLinks?.[i] ?? [],
  }));
  return JSON.stringify({ version: 1, project: { id: project.id, name: project.name, template: project.template }, screens }, null, 2);
}

export function prototypeSpecFileName(project: DesignProject, now: Date = new Date(), romanize?: Romanize | null): string {
  return designDocFileName(project, now, romanize).replace(/\.md$/, ".prototype.json");
}
