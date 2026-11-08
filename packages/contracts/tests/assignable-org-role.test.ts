import { describe, expect, it } from 'vitest';
import { operations as orgAdmin } from '../src/org-admin';
import { operations as platformMembers } from '../src/platform-members';
describe('organization role assignments', () => {
  for (const orgRole of ['lead', 'compliance']) {
    it(`rejects historical ${orgRole} assignments at both management boundaries`, () => {
      expect(orgAdmin.inviteOrgMember.in.safeParse({ orgId: 'org', email: 'member@example.test', teamId: 'team', orgRole }).success).toBe(false);
      expect(orgAdmin.setOrgMemberRole.in.safeParse({ orgId: 'org', userId: 'user', orgRole }).success).toBe(false);
      expect(platformMembers.setPlatformMemberOrgRole.in.safeParse({ orgId: 'org', userId: 'user', orgRole }).success).toBe(false);
    });
  }
  for (const orgRole of ['admin', 'consultant']) {
    it(`accepts ${orgRole}`, () => {
      expect(orgAdmin.setOrgMemberRole.in.safeParse({ orgId: 'org', userId: 'user', orgRole }).success).toBe(true);
      expect(platformMembers.setPlatformMemberOrgRole.in.safeParse({ orgId: 'org', userId: 'user', orgRole }).success).toBe(true);
    });
  }
});
