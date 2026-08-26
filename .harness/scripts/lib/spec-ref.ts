// spec-ref.ts — feature ↔ story 追溯校验（人类拍板 2026-07-19：每个 feature 必须
// 有一个 story 落在 phases/<phase>/requirements/ 下，用 requirements.template.md
// 的 R1..Rn 编号章节；这样才能形成"需求→feature→PR→GitHub issue"的闭环）。
//
// spec_ref 格式：`<requirements 目录下的文件名>#R<n>`，如 `auth.md#R3`。
// 校验分三层，任一层失败都判定不可解析（不是"格式对就算数"）：
//   1. 文件确实存在于 phases/<phase>/requirements/ 下；
//   2. 该文件不是未填写的裸模板；
//   3. 引用的章节 ID（## R<n> ...）确实存在于该文件里。
//
// "裸模板"怎么判定：不能只看 {{PHASE_NAME}} 这类占位符——new-phase.ts 用
// renderTemplateFile() 在 scaffold 那一刻就把 {{...}} 全替换成真实值了（见
// render.ts），文件落地时早就不含 {{}}，这个信号在人类填写之前就已经消失。
// 真正的信号是「内容是不是和刚 scaffold 出来那份一字不差」——把
// requirements.template.md 用这个 phase 的真实 PHASE_NAME/PHASE_ID 重新渲染一遍，
// 逐字比对：一样 = 没人碰过，仍是裸模板。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findPhaseDir } from "./paths";
import { loadRoadmap } from "./roadmap";
import { renderTemplateFile } from "./render";
import { parseFrontmatter, frontmatterString } from "./frontmatter";

const SPEC_REF_RE = /^([^#]+\.md)#(R\d+)$/;
const SECTION_HEADING_RE = (id: string) => new RegExp(`^##\\s+${id}\\b`, "m");

// ── 契约束锚点（2026-08-26，人类裁决方案 3）──────────────────────────────
// 背景：契约先行的束（`plan-control` / `agent-interrupts`）先签核、后生成
// `requirements/` 里的 story——这是流程顺序决定的，不是缺失。此前两条线各自
// 撞上「spec_ref 必须指向 requirements/*.md#R<n>」这道门：一条留空诚实登记
// （agent-interrupts，PR #2146），一条借用了无关 feature 的锚点（plan-control
// 借 08-chat/uc-8-2，导致那个 feature 的估点漂移检查跟着假红）。
//
// 方案 3：教 `resolveSpecRef` 认「已签核的契约束本身」为等价锚点，格式：
//   `contracts/<bundle>#confirmed`
// 与 `requirements/<file>.md#R<n>` 形式（下面的 SPEC_REF_RE）在语法上互斥
// （不含 `.md`，`#` 后固定是字面量 `confirmed` 而不是 `R\d+`），不会互相误判。
//
// 解析规则（三层，任一层失败都判不可解析——与 requirements 锚点同一纪律）：
//   1. `phases/<phase>/contracts/<bundle>/design-signoff.md` 必须存在；
//   2. 必须能解析出 frontmatter；
//   3. frontmatter 的 `status` 必须恰好是 `confirmed`——`pending` 或缺失都判红，
//      不能因为路径存在就放行（本仓「签了才算数」纪律的延伸）。
const CONTRACT_REF_RE = /^contracts\/([^/#]+)#confirmed$/;

function resolveContractRef(phaseId: string, bundle: string): SpecRefResult {
  let dir: string;
  try {
    dir = findPhaseDir(phaseId);
  } catch (e) {
    return { ok: false, reason: `找不到 Phase ${phaseId} 的目录：${(e as Error).message}` };
  }
  const signoffPath = join(dir, "contracts", bundle, "design-signoff.md");
  if (!existsSync(signoffPath)) {
    return {
      ok: false,
      reason: `spec_ref 指向的契约束 design-signoff.md 不存在：phases/phase-${phaseId}-*/contracts/${bundle}/design-signoff.md`,
    };
  }
  const fm = parseFrontmatter(signoffPath);
  const status = frontmatterString(fm, "status");
  if (status !== "confirmed") {
    return {
      ok: false,
      reason:
        `spec_ref 指向的契约束「${bundle}」尚未签核（status: ${status || "（缺失）"}）—— ` +
        `只有 status: confirmed 才能当锚点，这是人的动作，不能靠路径存在放行`,
    };
  }
  return { ok: true };
}

/** 某份需求文档是不是刚 scaffold 出来、没人碰过的裸模板。 */
function isUnfilledTemplate(phaseId: string, body: string): boolean {
  if (!body.trim()) return true;
  if (/\{\{\w+\}\}/.test(body)) return true; // 防御：万一渲染步骤被跳过
  const rm = loadRoadmap();
  const name = rm.phases.find((p) => p.id === phaseId)?.name;
  if (!name) return false; // roadmap 里查不到（异常情况），不误判为裸模板
  try {
    const virgin = renderTemplateFile("requirements.template.md", { PHASE_ID: phaseId, PHASE_NAME: name });
    return body.trim() === virgin.trim();
  } catch {
    return false; // 模板文件本身读不到，不阻塞——那是另一个更严重的问题
  }
}

export interface SpecRefResult {
  ok: boolean;
  /** 不合格时的一句话原因，直接可作为 die()/Finding 的消息用 */
  reason?: string;
}

export function requirementsDir(phaseId: string): string {
  return join(findPhaseDir(phaseId), "requirements");
}

/** requirements/ 文件夹是否存在、非空、且至少一份非 README 的 *.md 已经填了内容
 *  （不是原样保留的裸模板）。束级设计签核门（`auditSignoff`）用这个判定"有没有对应的 requirements"。
 *  ⚠ 2026-07-30 之前它的调用点是 phase 级 UI 门 `assertUiSignedOff`；那道门随 ADR-023 决策一
 *  撤掉，这条行为搬进了束级门（人类拍板 2026-07-19 的那条不许跟着一起消失）。 */
export function hasRequirementsCoverage(phaseId: string): SpecRefResult {
  let dir: string;
  try {
    dir = requirementsDir(phaseId);
  } catch (e) {
    return { ok: false, reason: `找不到 Phase ${phaseId} 的目录：${(e as Error).message}` };
  }
  if (!existsSync(dir)) return { ok: false, reason: `requirements/ 目录不存在（${dir}）` };
  const mdFiles = readdirSync(dir).filter((f) => f.toLowerCase() !== "readme.md" && f.endsWith(".md"));
  if (mdFiles.length === 0) return { ok: false, reason: `requirements/ 目录下没有需求文档（除 README.md 外为空）` };
  const filled = mdFiles.some((f) => !isUnfilledTemplate(phaseId, readFileSync(join(dir, f), "utf8")));
  if (!filled) {
    return {
      ok: false,
      reason: `requirements/ 里的 ${mdFiles.length} 份文档都还是刚 scaffold 出来、没人填写的裸模板`,
    };
  }
  return { ok: true };
}

/** 校验单个 feature 的 spec_ref：格式 + 文件存在 + 章节存在。 */
export function resolveSpecRef(phaseId: string, specRef: string | undefined | null): SpecRefResult {
  if (!specRef || !specRef.trim()) {
    return { ok: false, reason: "缺少 spec_ref（每个 feature 必须指向 requirements/ 下的一个 story 章节）" };
  }
  const trimmed = specRef.trim();
  const cm = CONTRACT_REF_RE.exec(trimmed);
  if (cm) {
    return resolveContractRef(phaseId, cm[1]!);
  }
  const m = SPEC_REF_RE.exec(trimmed);
  if (!m) {
    return {
      ok: false,
      reason:
        `spec_ref 格式不对："${specRef}"，应为 "<文件名>.md#R<n>"（如 auth.md#R3）` +
        `或 "contracts/<束>#confirmed"（已签核的契约束锚点）`,
    };
  }
  const [, file, sectionId] = m as unknown as [string, string, string];
  let dir: string;
  try {
    dir = requirementsDir(phaseId);
  } catch (e) {
    return { ok: false, reason: `找不到 Phase ${phaseId} 的目录：${(e as Error).message}` };
  }
  const path = join(dir, file);
  if (!existsSync(path)) {
    return { ok: false, reason: `spec_ref 指向的文件不存在：requirements/${file}` };
  }
  const body = readFileSync(path, "utf8");
  if (!SECTION_HEADING_RE(sectionId).test(body)) {
    return { ok: false, reason: `spec_ref 指向的章节 "${sectionId}" 在 requirements/${file} 里找不到（标题需形如 "## ${sectionId} ..."）` };
  }
  return { ok: true };
}
