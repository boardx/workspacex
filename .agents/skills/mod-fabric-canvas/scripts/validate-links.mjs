import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

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
      if (/^https?:\/\//.test(href) || href.startsWith('#')) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/')) throw Error(`Nonportable local link: ${href}`);
      const target = resolve(dirname(file), decodeURIComponent(href.split('#')[0]));
      if (!existsSync(target)) throw Error(`Missing relative link: ${relative(root, file)} -> ${href}`);
      const within = relative(root, realpathSync(target));
      if (within === '..' || within.startsWith(`..${sep}`)) throw Error(`Link escapes repository: ${href}`);
      checked.push({ file: relative(root, file), href, target: within });
    }
  }
  return { name: metadata.name, references: references.length, files: files.length, links: checked.length, checked, externalLinksVerified: false, businessAcceptanceProven: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(validateSkill(resolve(dirname(fileURLToPath(import.meta.url)), '..')), null, 2));
}
