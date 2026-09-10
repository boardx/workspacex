// @global-scope-fixture platform-org-write: 写 `org-platform` 名下的平台 skill 行。跨 org 可见是产品事实
//   （`pg-skill-contract-repository` 的 `OR sk.org_id = PLATFORM_ORG_ID`），`resetOrgs(<自己的 org>)`
//   碰不到它、`wave2_skill_immutable_trg` 又挡着删除 ⇒ **没有文件能收敛它**。断言侧一律按归属
//   过滤（`withoutPlatformOwnedSkills`），不要按名字——见 issue #2982 / PR #2978。
// @global-scope-fixture seeder:ensurePlatformSkillCatalogSeeded: 写 `org-platform` 名下的平台 skill 行。跨 org 可见是产品事实
//   （`pg-skill-contract-repository` 的 `OR sk.org_id = PLATFORM_ORG_ID`），`resetOrgs(<自己的 org>)`
//   碰不到它、`wave2_skill_immutable_trg` 又挡着删除 ⇒ **没有文件能收敛它**。断言侧一律按归属
//   过滤（`withoutPlatformOwnedSkills`），不要按名字——见 issue #2982 / PR #2978。
import { readFileSync } from 'node:fs';
import { skills as SkillContracts } from "@repo/contracts";
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ensureDatabase, migrateOnce, asApp, seedOrg, addOrgMember, resetOrgs } from '../support/db';
import { ensurePlatformSkillCatalogSeeded } from '../../src/infrastructure/skill/ensure-platform-skill-catalog';
import { STANDARD_PLATFORM_PACKS } from '../../src/infrastructure/skill/ensure-standard-skill-packs';
import { PLATFORM_ORG_ID } from '../../src/domain/org-id';
it('publishes shipped complete workflow packages through the existing importer and replays without duplicate versions',async()=>{
  ensureDatabase();await migrateOnce();
  const first=await ensurePlatformSkillCatalogSeeded();expect(first.ok).toBe(true);
  if(!first.ok)throw first.error;
  expect(first.report.standardPacks.map(p=>p.packId)).toEqual(STANDARD_PLATFORM_PACKS.map(p=>p.packId));
  const rows=await asApp(PLATFORM_ORG_ID,c=>c.query(`SELECT s.stable_name,v.id,count(f.path)::int AS files
    FROM skills s JOIN skill_versions v ON v.skill_id=s.id AND v.org_id=s.org_id
    JOIN skill_version_files f ON f.version_id=v.id AND f.org_id=v.org_id
    WHERE s.org_id=$1 AND v.published=true AND s.stable_name IN ('knowledge-grounded-answer','document-understanding','skill-authoring','visual-content','audio-transcription','meeting-minutes')
    GROUP BY s.stable_name,v.id`,[PLATFORM_ORG_ID]));
  expect(rows.rows).toHaveLength(6);expect(rows.rows.find(r=>r.stable_name==='knowledge-grounded-answer')?.files).toBe(5);expect(rows.rows.find(r=>r.stable_name==='document-understanding')?.files).toBe(3);expect(rows.rows.find(r=>r.stable_name==='skill-authoring')?.files).toBe(4);expect(rows.rows.find(r=>r.stable_name==='visual-content')?.files).toBe(4);
  for(const name of ['audio-transcription','meeting-minutes']) expect(rows.rows.find(r=>r.stable_name===name)?.files).toBe(4);
  const second=await ensurePlatformSkillCatalogSeeded();expect(second.ok).toBe(true);
  if(!second.ok)throw second.error;
  expect(second.report.standardPacks.every(p=>!p.created)).toBe(true);
  expect(second.report.standardPacks.map(p=>p.result)).toEqual(first.report.standardPacks.map(p=>p.result));
},120000);

it('exposes the published standard package through the actual Skills API to ordinary members in distinct organizations',async()=>{
  ensureDatabase();await migrateOnce();
  const seeded=await ensurePlatformSkillCatalogSeeded();if(!seeded.ok)throw seeded.error;
  const orgs=['standard-a-'+randomUUID(),'standard-b-'+randomUUID()];
  const keys={KERNEL_ALLOW_TEST_PRINCIPAL:'1',KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_QUIET:'1'};
  const previous=Object.fromEntries(Object.keys(keys).map(k=>[k,process.env[k]]));Object.assign(process.env,keys);
  for(const orgId of orgs){await seedOrg({orgId,projectId:'project-'+orgId});await addOrgMember(orgId,'reader','consultant',null);}
  const app=await (await import('../../src/main')).createApp();
  try {
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();const ids=[];
    for(const orgId of orgs){
      const response=await fetch(`${base}/skills?entry=library&q=${encodeURIComponent('组织知识问答')}`,{headers:{'x-kernel-test-principal':`reader:${orgId}`}});
      expect(response.status).toBe(200);const result=SkillContracts.operations.listSkills.out.parse(await response.json());expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({name:'组织知识问答',status:'已启用'});expect(result.items[0]!.currentVersionId).toBeTruthy();ids.push(result.items[0]!.skillId);
    }
    expect(ids[0]).toBe(ids[1]);
  }finally{await app.close();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await resetOrgs(orgs);}
},120000);

/**
 * 发货版本 = 组织**实际收到的正文**，不是一个版本号字符串。
 *
 * #3150 的裁决是把 `standard-web` 的发货版本从 1.1.1 升到 1.1.2。1.1.2 相对 1.1.1 的
 * 唯一实质差异在 `web-artifact`：`SKILL.md` 从 **3384** 字节（semanticVersion 1.0.1）
 * 变成 **5439** 字节（1.0.2，多出有界执行计划 / HTML 必须按 `text/html` 发布 / 证据
 * 措辞硬边界三节）。所以这条断言直接钉**平台组织里生效版本的字节数**——只钉版本号
 * 会在「号升了、正文没下发」时照样绿，那正是 #3181 之前的故障形态
 * （`platform-builtin:standard-web:1.1.2 | failed | SKILL_STARTER_PACK_CONFLICT`
 * 而 `web-artifact` 停在 3384 字节）。
 *
 * ⚠ 反证记录（本 PR 落地时实测）：把 `STANDARD_PLATFORM_PACKS` 的 `standard-web`
 *   改回 1.1.1，这条用例红在 `expected 3384 to be 5439`——它确实在测正文，不是在
 *   复述常量。
 *
 * 后半段钉「其余八个包不受影响」：九个包全部 `ok`，一个都没被 standard-web 的升级
 * 连累（#3181 的 per-pack 隔离在真实发货清单上的体现）。
 */
it('ships standard-web 1.1.2 content: the platform org actually receives the 5439-byte web-artifact, and the other eight packs are untouched', async () => {
  ensureDatabase(); await migrateOnce();
  const seeded = await ensurePlatformSkillCatalogSeeded();
  expect(seeded.ok).toBe(true);
  if (!seeded.ok) throw seeded.error;

  // 九个包逐个成功——升级 standard-web 没有把别的包带下水。
  expect(seeded.report.standardPacks.map(p => p.packId)).toEqual(STANDARD_PLATFORM_PACKS.map(p => p.packId));
  expect(seeded.report.standardPacks.filter(p => !p.ok)).toEqual([]);

  const rows = await asApp(PLATFORM_ORG_ID, c => c.query<{ semantic_label: string; bytes: number }>(
    `SELECT v.semantic_label, octet_length(f.content)::int AS bytes
       FROM skills s
       JOIN skill_versions v ON v.skill_id = s.id AND v.org_id = s.org_id
       JOIN skill_version_files f ON f.version_id = v.id AND f.org_id = v.org_id AND f.path = 'SKILL.md'
      WHERE s.org_id = $1 AND s.stable_name = 'web-artifact' AND v.published = true
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT 1`, [PLATFORM_ORG_ID]));
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0]!.bytes).toBe(5439);
  expect(rows.rows[0]!.semantic_label).toBe('1.0.2');
}, 300000);

/**
 * 人类直接指令（2026-09-10）：「新建一个 skill 叫做 MAAU 模板……我可以在 chat 里面说
 * 生成 MAAU 模板，就可以触发这个技能」。这条用例钉的是那句话里的**「在 chat 里面能看到」**
 * ——不是「build.ts 里加了一行」，也不是「starter-pack JSON 里有这个名字」。
 *
 * 与上面 standard-web 那条同一套纪律：钉**平台组织里生效版本的真实字节**，不钉版本号。
 * `standard-methods` 从 1.0.1 升到 1.1.0 的唯一实质差异就是新增 `maau-canvas`
 * （前两个 skill 逐字节不变，由 `skills/standard-methods/scripts/verify.ts` 断言），
 * 所以「号升了、正文没下发」在这里会红在字节数上，而不是悄悄绿掉。
 *
 * ⚠ 反证记录（实测）：把 `STANDARD_PLATFORM_PACKS` 的 `standard-methods` 改回更早的版本，
 *   这条用例会红——1.0.1 时红在 `expected [] to have a length of 2 but got +0`（平台组织里
 *   根本查不到 `maau-canvas`），1.1.0 时红在正文断言（下发的还是调 `wx_image_generate` 的
 *   那一版）。它确实在测下发结果，不是在复述常量。
 */
/** 编辑源的真实字节数——不抄成常量：抄一份就是同一事实第二处声明，改了正文忘了改数字
 *  这条会以"数字没跟上"的形态红，读起来像下发坏了，其实是断言自己过期了。
 *  `scripts/verify.ts` 已经断言过"包里的字节 == 编辑源的字节"，这里再断言"库里的字节 ==
 *  编辑源的字节"，两条接起来就是"库里生效的正文 == 仓库里的正文"。 */
const editingSourceBytes = (path: string): number =>
  readFileSync(new URL(`../../../../skills/standard-methods/maau-canvas/${path}`, import.meta.url)).length;

it('ships standard-methods 1.2.0 content: the platform org actually receives the A3-infographic maau-canvas, not the image-generating one', async () => {
  ensureDatabase(); await migrateOnce();
  const seeded = await ensurePlatformSkillCatalogSeeded();
  expect(seeded.ok).toBe(true);
  if (!seeded.ok) throw seeded.error;
  expect(seeded.report.standardPacks.filter(p => !p.ok)).toEqual([]);

  const rows = await asApp(PLATFORM_ORG_ID, c => c.query<{ name: string; semantic_label: string; path: string; bytes: number }>(
    `SELECT s.name, v.semantic_label, f.path, octet_length(f.content)::int AS bytes
       FROM skills s
       JOIN skill_versions v ON v.skill_id = s.id AND v.org_id = s.org_id
       JOIN skill_version_files f ON f.version_id = v.id AND f.org_id = v.org_id
      WHERE s.org_id = $1 AND s.stable_name = 'maau-canvas' AND v.published = true
      ORDER BY f.path COLLATE "C"`, [PLATFORM_ORG_ID]));
  expect(rows.rows).toHaveLength(2);
  // 目录里显示的名字就是用户会说出口的那四个字——它是模型匹配这个技能的抓手。
  expect(rows.rows.every(r => r.name === 'MAAU 模板' && r.semantic_label === '2.0.0')).toBe(true);
  expect(rows.rows.map(r => [r.path, r.bytes])).toEqual([
    ['SKILL.md', editingSourceBytes('SKILL.md')],
    ['references/canvas-template.md', editingSourceBytes('references/canvas-template.md')],
  ]);
  // 换代的实质不在版本号上：平台组织里生效的那份正文必须是「不调图像模型、改出 A3 版式」的
  // 那一版。只钉 semantic_label='2.0.0' 会在「号升了、正文还是旧的」时照样绿。
  const entry = await asApp(PLATFORM_ORG_ID, c => c.query<{ body: string }>(
    `SELECT convert_from(f.content,'UTF8') AS body
       FROM skills s
       JOIN skill_versions v ON v.skill_id = s.id AND v.org_id = s.org_id
       JOIN skill_version_files f ON f.version_id = v.id AND f.org_id = v.org_id AND f.path = 'SKILL.md'
      WHERE s.org_id = $1 AND s.stable_name = 'maau-canvas' AND v.published = true`, [PLATFORM_ORG_ID]));
  const body = entry.rows[0]!.body;
  expect(body).toContain('browser_take_screenshot');
  expect(body).toContain('A3');
  expect(body).not.toContain('wx_image_generate');
}, 300000);
