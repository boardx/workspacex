// templates-allocate.ts — HMV2-009：原子 Template ID 分配器。
//
// pnpm harness templates allocate --domain <XXX> --name "..." --owner <id>
//                                  [--authority <text>] [--id TPL-XXX-NNN]
//
// 用法与 `new-adr.ts` 同一套心智：占号即登记（这次运行结束时新条目已经写进
// registry.yaml），不是申请一个号再回头补登记——那样两个并发分支会各自拿到
// "看起来空闲"的号，直到合并才发现撞车（ADR-018 的真实事故）。
//
// **写回方式是文本级追加，不是 parse→stringify 整个文件重写**：`yaml` 库的
// stringify 不保留注释和既有格式，会把 registry.yaml 顶部那段解释"为什么
// owner/consumers 暂时是这样"的注释全部吃掉。新条目跟随既有条目的书写格式，
// 追加到 `entries:` 数组末尾，这样一次 `git diff` 只显示新增的那几行。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib/paths";
import { readRegistryFile } from "./lib/template-scan";
import { validateRegistry } from "./lib/template-model";
import { findTemplateIdConflict, nextTemplateId, parseTemplateId } from "./lib/template-id";
import { req } from "./lib/args";
import { log, die } from "./lib/log";
import type { Args } from "./lib/args";

const REGISTRY_PATH = join(REPO_ROOT, ".harness", "templates", "registry.yaml");

export function templatesAllocate(args: Args): void {
  const name = req(args, "name");
  const owner = args.opts["owner"] ?? "coord-architecture";
  const authority = args.opts["authority"] ?? "人工维护";
  const consumers = args.opts["consumers"]?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

  const { parsed, error } = readRegistryFile(REGISTRY_PATH);
  if (error) die(`读注册表失败：${error}`);
  const result = validateRegistry(parsed);
  if (!result.ok || !result.value) {
    die(`注册表当前不合法，先修好再分配新号：\n${result.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
  }
  const registry = result.value!;

  let id: string;
  if (args.opts["id"]) {
    id = args.opts["id"]!;
    if (!parseTemplateId(id)) die(`--id "${id}" 不是合法格式，应为 TPL-<三位大写字母>-<三位数字>（如 TPL-REQ-002）。`);
    const conflict = findTemplateIdConflict(id, registry.entries);
    if (conflict) die(`--id ${id} 已被占用：${conflict}`);
  } else {
    const domain = req(args, "domain").toUpperCase();
    if (!/^[A-Z]{3}$/.test(domain)) die(`--domain 必须是三位字母（如 REQ），实得 "${domain}"`);
    id = nextTemplateId(domain, registry.entries.map((e) => e.template_id));
  }

  const consumersLiteral = consumers.length === 0 ? "[]" : `[${consumers.join(", ")}]`;
  const block =
    `\n  - template_id: ${id}\n` +
    `    template_version: 1\n` +
    `    name: ${name}\n` +
    `    status: active\n` +
    `    owner: ${owner}\n` +
    `    consumers: ${consumersLiteral}\n` +
    `    authority: ${authority}\n`;

  const raw = readFileSync(REGISTRY_PATH, "utf8");
  writeFileSync(REGISTRY_PATH, raw.replace(/\n$/, "") + block, "utf8");

  log.ok(`已分配 ${id}（name="${name}"），写回 ${REGISTRY_PATH.replace(REPO_ROOT + "/", "")}`);
  log.info("下一步：为这个模板类型的实例文档定好命名约定，需要的话补一份 rationale 说明为什么新增这一类模板。");
}
