import assert from 'node:assert/strict';
import test from 'node:test';
import {identity} from '@repo/contracts';
import {BOARD_SECURITY_ORG_ROLE} from './board-security-fixture';

test('security fixture uses the canonical organization administrator role',()=>{
  assert.equal(identity.OrgRole.parse(BOARD_SECURITY_ORG_ROLE),'admin');
  assert.equal(identity.OrgRole.safeParse('org_admin').success,false);
});
