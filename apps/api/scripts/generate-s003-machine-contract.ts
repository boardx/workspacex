/** Derive S003 package schemas from the authoritative machine contract. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";
import { s003MachineSchemas } from "../src/application/work-eval/s003-contract";
const path = resolve(import.meta.dirname, "../../../skills/work-research/enterprise-search/SKILL.md");
const source = readFileSync(path, "utf8");
const match = /^---\n([\s\S]*?)\n---/.exec(source);
if (!match) throw new Error("S003 package frontmatter missing");
const frontmatter = parse(match[1]!);
Object.assign(frontmatter.metadata.work, s003MachineSchemas);
const generated = `---\n${stringify(frontmatter)}---${source.slice(match[0].length)}`;
if (process.argv.includes("--check")) {
  if (generated !== source) throw new Error("S003 machine schema drift; run generate-s003-machine-contract.ts");
} else writeFileSync(path, generated);
