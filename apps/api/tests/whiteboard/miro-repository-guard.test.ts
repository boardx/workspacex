import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repo=readFileSync('src/infrastructure/whiteboard/pg-miro-credential-repository.ts','utf8');
const migration=readFileSync('migrations/20260924000800_whiteboard_miro_direct_import.sql','utf8');

describe('Miro credential repository boundary',()=>{
  it('keeps every method tenant-scoped and every credential/state query actor-scoped',()=>{
    expect((repo.match(/withTenant\(/g)??[]).length).toBe(7);
    for(const sql of repo.match(/`[^`]+`/g)??[]){
      if(!/whiteboard_miro_(?:oauth_states|credentials)/.test(sql))continue;
      expect(sql).toMatch(/org_id=\$1|org_id,actor_id/);expect(sql).toMatch(/actor_id=\$2|org_id,actor_id/);
    }
    expect(repo).toMatch(/revoked_at IS NULL/);expect(repo).toMatch(/consumed_at IS NULL AND expires_at>\$4/);
    expect(repo).not.toMatch(/access_token|refresh_token|client_secret/i);
  });
  it('stores ciphertext only and makes RLS/grants explicit and tenant-local',()=>{
    expect(migration).toContain('sealed_credentials text NOT NULL');
    expect(migration).not.toMatch(/access_token|refresh_token|client_secret/i);
    for(const table of ['whiteboard_miro_oauth_states','whiteboard_miro_credentials','whiteboard_miro_audit']){
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`org_id=current_setting('app.current_org',true)`);
    }
    expect(migration).toContain('REFERENCES organizations(id) ON DELETE CASCADE');
    expect(migration).toContain('REVOKE ALL ON whiteboard_miro_oauth_states,whiteboard_miro_credentials,whiteboard_miro_audit FROM app_rw');
  });
});
