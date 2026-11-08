import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
const sql = readFileSync(new URL('../../migrations/20261108120000_active_organization_roles.sql', import.meta.url), 'utf8');
// Run this DDL regression alone in its own with-test-isolation invocation.
it('normalizes legacy membership grants, preserves admin and fences future legacy writes', async () => {
  ensureDatabase(); await migrateOnce();
  const org = 'org-active-role-migration';
  await seedOrg({ orgId: org, projectId: `${org}-project` });
  try {
    await asOwner(async c => {
      await c.query('BEGIN');
      try {
        await c.query('ALTER TABLE org_memberships DROP CONSTRAINT org_memberships_active_org_role');
        await c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,'legacy-lead','lead'),($1,'legacy-compliance','compliance'),($1,'preserved-admin','admin')", [org]);
        await c.query('ALTER TABLE org_invites DROP CONSTRAINT org_invites_active_org_role');
        await c.query('ALTER TABLE org_invite_links DROP CONSTRAINT org_invite_links_active_org_role');
        await c.query("INSERT INTO org_invites(id,org_id,email,org_role,status,invited_by) VALUES('legacy-invite',$1,'legacy@example.test','lead','pending','admin')", [org]);
        await c.query("INSERT INTO org_invite_links(id,org_id,org_role,expiry,status,created_by) VALUES('legacy-link',$1,'compliance','7d','pending-review','admin')", [org]);
        await c.query(sql);
        expect((await c.query("SELECT org_role FROM org_invites WHERE id='legacy-invite'")).rows[0].org_role).toBe('consultant');
        expect((await c.query("SELECT org_role FROM org_invite_links WHERE id='legacy-link'")).rows[0].org_role).toBe('consultant');
        const rows = (await c.query("SELECT user_id,org_role FROM org_memberships WHERE org_id=$1 AND user_id IN ('legacy-lead','legacy-compliance','preserved-admin') ORDER BY user_id", [org])).rows;
        expect(rows).toEqual([{user_id:'legacy-compliance',org_role:'consultant'},{user_id:'legacy-lead',org_role:'consultant'},{user_id:'preserved-admin',org_role:'admin'}]);
        await c.query('SAVEPOINT rejected_write');
        await expect(c.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,'forbidden-lead','lead')", [org])).rejects.toMatchObject({ code:'23514' });
        await c.query('ROLLBACK TO SAVEPOINT rejected_write');
      } finally { await c.query('ROLLBACK'); }
    });
  } finally { await resetOrgs(org); }
});
