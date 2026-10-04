import { describe, expect, it } from "vitest";
import { loadPinnedMethodFiles } from "../../src/infrastructure/work-content/pinned-method-files";
import { PgContentSkillInstructions } from "../../src/infrastructure/work-content/pg-content-skill-instructions";
import { ModelContentSkillRunner } from "../../src/application/work-content/content-skill-runner";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { ModelCallPort } from "../../src/application/agent-run/ports";

const load = (root: string, files: Record<string, string> = {}) => loadPinnedMethodFiles(root, "S064@1.1.0", async p => files[p] ?? null);
describe("pinned method references", () => {
  it("loads explicit inline and reference links once, preserving origin and ignoring code/images/external URLs", async () => {
    const root = '[method](references/a.md#step)\n[again][a]\n[a]: references/a.md\n![image](references/missing.md)\n`[code](references/missing.md)`\n[external](https://example.com/a.md)';
    expect(await load(root, { "references/a.md": "Do not invent quotations. [next](b.md)", "references/b.md": "Mark unknown counts." })).toBe(
      `Skill S064@1.1.0 source: SKILL.md\n${root}\n\nSkill S064@1.1.0 source: references/a.md\nDo not invent quotations. [next](b.md)\n\nSkill S064@1.1.0 source: references/b.md\nMark unknown counts.`,
    );
  });
  it("preserves single-file versions and never treats plain repo pointers as executable links", async () => {
    const root = 'Read `requirements/work-stack-v2/skills/S064.md`. [section](#method)';
    expect(await load(root)).toBe(root);
  });
  it.each(['../outside.md', '/outside.md', 'references/%2e%2e/a.md', 'references/a\\b.md', 'requirements/S064.md', 'references/a.md?version=latest'])('rejects unsafe reference %s', async path => {
    await expect(load(`[method](${path})`)).rejects.toThrow('CONTENT_SKILL_METHOD_REFERENCE_INVALID');
  });
  it("fails closed on missing methods and cycles", async () => {
    await expect(load('[method](references/a.md)')).rejects.toThrow('CONTENT_SKILL_METHOD_REFERENCE_MISSING');
    await expect(load('[method](references/a.md)', { 'references/a.md': '[loop](a.md)' })).rejects.toThrow('CONTENT_SKILL_METHOD_REFERENCE_CYCLE');
  });
  it("bounds cumulative bytes, depth and file count", async () => {
    await expect(load('x'.repeat(256 * 1024 + 1))).rejects.toThrow('CONTENT_SKILL_METHOD_REFERENCE_LIMIT');
    const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`references/${i}.md`, `[next](${i + 1}.md)`]));
    await expect(load('[start](references/0.md)', files)).rejects.toThrow('CONTENT_SKILL_METHOD_REFERENCE_LIMIT');
    await expect(load(Array.from({ length: 16 }, (_, i) => `[m](references/${i}.md)`).join('\n'), Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`references/${i}.md`, 'method'])))).rejects.toThrow('CONTENT_SKILL_METHOD_REFERENCE_LIMIT');
  });
  it("sends same-tenant published pinned method to model; newer/foreign/missing references cannot substitute", async () => {
    const reads: unknown[][] = [];
    const session = { query: async (sql: string, params: unknown[]) => {
      reads.push(params);
      expect(sql).toContain('v.semantic_label = $3 AND v.published');
      const [org, id, version, path = 'SKILL.md'] = params;
      const body = org === 'org-method' && id === 'S064' && version === '1.1.0'
        ? path === 'SKILL.md' ? '[method](references/a.md)' : 'PINNED_METHOD_DO_NOT_INVENT' : undefined;
      return { rows: body ? [{ content: Buffer.from(body) }] : [] };
    } } as unknown as TenantSession;
    const db = { withTenant: async (org: string, fn: (s: TenantSession) => Promise<unknown>) => {
      expect(['org-method', 'org-other']).toContain(org); return fn(session);
    } } as unknown as DatabasePort;
    const skills = new PgContentSkillInstructions(db);
    let system = '';
    const model = { complete: async (request: { system: string }) => { system = request.system; return { text: '{}' }; } } as unknown as ModelCallPort;
    const runner = new ModelContentSkillRunner(model, { agentVersionModel: async () => ({ modelProvider: 'pinned', modelId: 'pinned' }) }, skills);
    await runner.run({ orgId: 'org-method', instanceId: 'i', agentVersionId: 'av', workflowId: 'W029', stageId: 'frame', skillId: 'S064', skillVersion: '1.1.0', input: {}, prior: {} });
    expect(system).toContain('PINNED_METHOD_DO_NOT_INVENT');
    expect(system).toContain('Skill S064@1.1.0 source: references/a.md');
    expect(reads).toEqual([['org-method', 'S064', '1.1.0'], ['org-method', 'S064', '1.1.0', 'references/a.md']]);
    expect(await skills.skillInstructions('org-other', 'S064', '1.1.0')).toBeNull();
    expect(await skills.skillInstructions('org-method', 'S064', '2.0.0')).toBeNull();
  });
});
