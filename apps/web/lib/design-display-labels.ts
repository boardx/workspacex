import { designPrototype } from "@repo/contracts";
import type { Locale } from "./i18n/locale";
import { translate, type MessageKey } from "./i18n/messages";
import { designDocumentEn, designDocumentNodeEn } from "./i18n/namespaces/design-document";
import { PROJECT_TEMPLATE_LABEL, type DesignProject, type ProjectTemplate, type PrototypeNode } from "./live-design-workbench";

/** Pure display projections. Contract values and the existing Chinese authorities stay intact. */
export function projectTemplateDisplayLabel(template: ProjectTemplate, locale: Locale = "zh-CN"): string {
  return locale === "zh-CN" ? PROJECT_TEMPLATE_LABEL[template] : translate(locale, `designDocument.templateLabel.${template}`);
}

export function prototypeOptionDisplayLabel(type: string, key: string, value: string | undefined, locale: Locale = "zh-CN"): string | undefined {
  if (value === undefined) return undefined;
  const canonical = designPrototype.prototypeOptionLabel(type, key, value);
  if (locale === "zh-CN") return canonical;
  // Match the contract's type-specific / field-level / verbatim fallback order.
  const labels = designPrototype.PROTOTYPE_OPTION_LABELS;
  // The document uses list.icons for per-row icons; only English projects the
  // shared icon display metadata. Its historical Chinese fallback stays verbatim.
  const fieldKey = type === "list" && key === "icons" ? "icon" : key;
  const field = Object.hasOwn(labels[`${type}.${fieldKey}`] ?? {}, value) ? `${type}.${fieldKey}` : fieldKey;
  if (!Object.hasOwn(labels[field] ?? {}, value)) return canonical;
  const messageKey = `designDocument.option.${field}.${value}`;
  return Object.hasOwn(designDocumentEn, messageKey) ? translate(locale, messageKey as MessageKey) : canonical;
}

const ACCENT_KEYS: Record<DesignProject["accent"], MessageKey> = {
  neutral: "designDocument.noneNeutralGray", blue: "designDocument.indigo", violet: "designDocument.violet", teal: "designDocument.teal",
  green: "designDocument.green", amber: "designDocument.amber", rose: "designDocument.rose", slate: "designDocument.slate",
};
export function designAccentDisplayLabel(accent: DesignProject["accent"], locale: Locale = "zh-CN"): string {
  const key = Object.hasOwn(ACCENT_KEYS, accent) ? ACCENT_KEYS[accent] : undefined;
  return key === undefined ? accent : translate(locale, key);
}

/** Canonical Chinese short labels are also used in model prompts, so localize only this display projection. */
export function prototypeNodeDisplayLabel(n: PrototypeNode, locale: Locale = "zh-CN"): string {
  if (locale === "zh-CN") return designPrototype.prototypeNodeLabel(n);
  const node = (key: keyof typeof designDocumentNodeEn, ...values: (string | number)[]): string =>
    designDocumentNodeEn[key].replace(/\{v(\d+)\}/g, (token, index: string) => values[Number(index)] === undefined ? token : String(values[Number(index)]));
  const doc = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  switch (n.type) {
    case "text": return node("text", n.props.content.slice(0, 20));
    case "button": return node("button", n.props.label);
    case "navbar": return node("navbar", n.props.title);
    case "card": return n.props?.title !== undefined ? doc("designDocument.card2", { v0: n.props.title }) : doc("designDocument.card");
    case "input": return node("input", n.props.label ?? n.props.placeholder ?? "");
    case "badge": return node("badge", n.props.label);
    case "image": return node("image", n.props.alt);
    case "list": return node("list", n.props.items.length);
    case "tabs": return node("tabs", n.props.items.join("/"));
    case "avatar": return node("avatar", n.props.name);
    case "stack": return node(n.props?.direction === "row" ? "row" : "column");
    case "divider": return doc("designDocument.divider");
    case "spacer": return doc("designDocument.spacer");
    case "bottomnav": return node("bottomnav", n.props.items.join("/"));
    case "switch": return node("switch", n.props.label);
    case "checkbox": return node("checkbox", n.props.label);
    case "chip": return node("chip", n.props.label);
    case "progress": return doc("designDocument.progress", { v0: n.props.value, v1: "" });
    case "stat": return node("stat", n.props.label);
    case "hero": return node("hero", n.props.title);
    case "grid": return doc("designDocument.gridColumns", { v0: n.props?.columns ?? 2 });
    case "table": return node("table", n.props.columns.length, n.props.rows.length);
    case "section": return node("section", n.children.length);
    case "footer": return node("footer", n.props.brand);
    case "select": return node("select", n.props.label ?? n.props.value ?? n.props.placeholder ?? n.props.options[0] ?? "");
    case "radio": return node("radio", n.props.options.join("/"));
    case "overlay": return `${doc(n.props?.kind === "sheet" ? "designDocument.bottomSheet" : n.props?.kind === "toast" ? "designDocument.toast" : "designDocument.dialog")}${n.props?.title !== undefined ? `「${n.props.title}」` : ""}`;
    case "chart": return n.props.title !== undefined ? node("chart", n.props.title) : node("chartPoints", doc(n.props.kind === "line" ? "designDocument.lineChart" : "designDocument.barChart"), n.props.values.length);
    case "html": return node("html");
    case "board": return node("board", n.props.items.length, (n.props.links ?? []).length > 0 ? node("boardLinks", (n.props.links ?? []).length) : "");
  }
}
