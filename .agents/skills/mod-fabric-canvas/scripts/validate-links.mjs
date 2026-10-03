import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse } from 'yaml';

const contractsRequire = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/contracts/package.json'));
const { unified } = await import(contractsRequire.resolve('unified'));
const { default: remarkParse } = await import(contractsRequire.resolve('remark-parse'));

function explicitAnchors(source) {
  const tree = unified().use(remarkParse).parse(source), anchors = new Set();
  const visit = node => {
    if (node.type === 'html') {
      const match = /^<a\s+id=["']([^"']+)["']\s*>(?:\s*<\/a>)?$/.exec(node.value.trim());
      if (match) anchors.add(match[1]);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return anchors;
}

export function validateSkill(skillDir, repoRoot = resolve(skillDir, '../../..')) {
  const root = realpathSync(repoRoot), entry = resolve(skillDir, 'SKILL.md');
  const source = readFileSync(entry, 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!frontmatter) throw Error('Missing skill frontmatter');
  const metadata = parse(frontmatter[1]);
  if (metadata?.name !== 'mod-fabric-canvas' || typeof metadata.description !== 'string' || !metadata.description.trim()) throw Error('Invalid skill name or description');
  const links = text => [...text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)].map(match => match[1]);
  const references = [...new Set(links(source).filter(href => href.startsWith('references/')))];
  if (references.length !== 6) throw Error('Expected six discoverable references');
  const files = [entry, ...references.map(href => resolve(skillDir, href))];
  const checked = [];
  for (const file of files) {
    for (const href of links(readFileSync(file, 'utf8'))) {
      if (/^https?:\/\//.test(href)) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/')) throw Error(`Nonportable local link: ${href}`);
      const [path, fragment] = href.split('#');
      const target = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      if (!existsSync(target)) throw Error(`Missing relative link: ${relative(root, file)} -> ${href}`);
      const within = relative(root, realpathSync(target));
      if (within === '..' || within.startsWith(`..${sep}`)) throw Error(`Link escapes repository: ${href}`);
      // Explicit anchors avoid duplicating renderer-specific heading slug rules.
      if (fragment && !explicitAnchors(readFileSync(target, 'utf8')).has(decodeURIComponent(fragment))) throw Error(`Missing explicit anchor: ${relative(root, file)} -> ${href}`);
      checked.push({ file: relative(root, file), href, target: within });
    }
  }
  return { name: metadata.name, references: references.length, files: files.length, links: checked.length, checked, externalLinksVerified: false, businessAcceptanceProven: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(validateSkill(resolve(dirname(fileURLToPath(import.meta.url)), '..')), null, 2));
}
