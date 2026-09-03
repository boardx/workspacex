/**
 * WorkspaceX 品牌邮件外壳——把「主题 + 纯文本正文」渲染成一份专业、统一视觉的 HTML 邮件。
 *
 * ## 为什么放在这一层，不放在 use-case
 *
 * `application/notifications/transactional-mail-ports.ts` 的头注说得很清楚：
 * 端口本身不含任何业务文案，主题/正文由调用方（use-case）拼好再传进来。这份文件
 * 加的是**呈现**——同一段文案套什么视觉外壳——不是业务文案，所以放在
 * infrastructure（两个 transport 的姊妹文件，`cloudflare-email-transport.ts` /
 * `cloudflare-transactional-email-transport.ts` 都会 import 它），而不是让每个
 * use-case 各自拼一遍 HTML。这样两条邮件通路（验证邮件 / 任意事务邮件）视觉统一，
 * 改一次样式两边都生效，不会出现"改了一个模板忘了另一个"的漂移。
 *
 * ## 邮件客户端兼容性
 *
 * 邮件渲染引擎（Outlook 桌面版尤其）对现代 CSS 支持残缺，所以：
 *   · 布局用 `<table>`，不用 flex/grid。
 *   · 所有样式内联在标签上，不依赖 `<style>` 块里的选择器（保留一份 `<style>` 只为
 *     深色模式媒体查询和无法内联的伪类，纯增强，丢了也不影响可读性）。
 *   · logo 是纯文字 logotype（"Workspace" 实心品牌粉 + "X" 渐变，渐变用
 *     `background-clip:text` 做渐进增强，不支持的客户端回退成纯色粉），不用图片——
 *     不依赖任何外部图床/静态资源 URL，邮件客户端的"默认不加载外部图片"不会让它
 *     变成一个破图标。
 */

const BRAND_PINK = "#ff2d78";
const BRAND_ORANGE = "#ff7a3d";
const BRAND_GRADIENT = `linear-gradient(135deg, ${BRAND_ORANGE} 0%, ${BRAND_PINK} 65%, #e31c71 100%)`;
const INK = "#17171a"; // 与 apps/web 的 --primary（近黑）保持一致，见 app/globals.css
const MUTED = "#6b6b70";
const BORDER = "#e7e7ea";
const CANVAS = "#f6f6f8";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 纯文本正文按空行/换行切段落；过滤掉 join("\n") 留下的空字符串。 */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface BrandEmailContent {
  /** 邮件正文标题，通常同 subject 或 subject 的简短版本。 */
  readonly heading: string;
  /** 纯文本正文——按换行切段落渲染，不接受也不解析 HTML。 */
  readonly text: string;
  /** 可选的行动按钮（验证邮件的验证链接、反馈邮件的查看详情链接……）。 */
  readonly cta?: { readonly label: string; readonly url: string };
  /** 收件箱列表预览摘要（大多数客户端会显示在主题旁边）；缺省用 heading。 */
  readonly preheader?: string;
}

/** 渲染品牌邮件外壳。调用方保证 `content` 里的文本不含需要当 HTML 解析的内容——这里全程转义。 */
export function renderBrandEmailHtml(content: BrandEmailContent): string {
  const heading = escapeHtml(content.heading);
  const preheader = escapeHtml(content.preheader ?? content.heading);
  const paragraphsHtml = paragraphsOf(content.text)
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:${INK};">${escapeHtml(line)}</p>`,
    )
    .join("\n");
  const ctaHtml = content.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
        <tr>
          <td style="border-radius:10px;background:${BRAND_GRADIENT};background-color:${BRAND_PINK};">
            <a href="${escapeHtml(content.cta.url)}"
               style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${escapeHtml(content.cta.label)}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${heading}</title>
<style>
  @media (prefers-color-scheme: dark) {
    body, .wx-canvas { background:#0f0f11 !important; }
    .wx-card { background:#18181b !important; border-color:#2b2b30 !important; }
    .wx-ink { color:#f2f2f4 !important; }
    .wx-muted { color:#9a9aa0 !important; }
  }
  .wx-logo-x {
    background: ${BRAND_GRADIENT};
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
</style>
</head>
<body style="margin:0;padding:0;background:${CANVAS};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="wx-canvas" style="background:${CANVAS};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          <tr>
            <td style="padding:0 8px 20px;">
              <span style="font-size:20px;font-weight:800;letter-spacing:-0.02em;color:${BRAND_PINK};">Workspace</span
              ><span class="wx-logo-x" style="font-size:20px;font-weight:800;color:${BRAND_PINK};">X</span>
            </td>
          </tr>
          <tr>
            <td class="wx-card" style="background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:4px;line-height:4px;font-size:0;background:${BRAND_GRADIENT};">&nbsp;</td></tr>
                <tr>
                  <td style="padding:32px 32px 28px;">
                    <h1 class="wx-ink" style="margin:0 0 16px;font-size:20px;line-height:1.4;color:${INK};">${heading}</h1>
                    ${paragraphsHtml}
                    ${ctaHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0;">
              <p class="wx-muted" style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
                这是 WorkspaceX 发出的系统通知邮件，请勿直接回复。
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
