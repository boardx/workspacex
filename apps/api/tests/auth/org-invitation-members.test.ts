import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgOrgInviteRepository} from '../../src/infrastructure/auth/pg-org-invite-repository';
import {PgOrgInviteLinkRepository} from '../../src/infrastructure/auth/pg-org-invite-link-repository';
import {inviteOrgMember} from '../../src/application/auth/invite-org-member';
import {createOrgInviteLink} from '../../src/application/auth/create-org-invite-link';
import {activateOrgMember} from '../../src/application/auth/activate-org-member';
import {hashOrgInviteLinkToken} from '../../src/domain/auth/org-invite-link';
import {toOrgId} from '../../src/domain/org-id';
import {addCredential,addOrgMember,asOwner,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from '../support/db';
import {fakeHasher,fakeSessions,fakeTokens,NO_CLAIMS} from '../support/org-invite';
const run=Date.now().toString(36);
const ORG='org-invite-6316', admin=`u-invite-admin-${run}`, member=`u-invite-member-${run}`, other=`u-invite-other-${run}`;
const email=`invited-${run}@example.test`;
let db:PgDatabase,repo:PgOrgInviteRepository,links:PgOrgInviteLinkRepository;
const ctx={orgId:toOrgId(ORG),actorId:admin,actorOrgRole:'admin'};
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());repo=new PgOrgInviteRepository(db);links=new PgOrgInviteLinkRepository(db);await addCredential(admin,`admin-${run}@example.test`,'Admin');await addCredential(member,email,'Member');await addCredential(other,`other-${run}@example.test`,'Other');},60000);
beforeEach(async()=>{await resetOrgs(ORG);await seedOrg({orgId:ORG,projectId:`${ORG}-p`,seatQuota:10});await addOrgMember(ORG,admin,'admin',null);});
afterAll(async()=>{await resetOrgs(ORG);await db?.close();});
it('creates an immediately usable ordinary invitation even when a legacy client asks for admin',async()=>{
 const out=await inviteOrgMember({repo},{...ctx,email,orgRole:'admin',teamId:null});
 expect(out.status).toBe('pending');expect(out.token).toBeTruthy();
 const row=await asOwner(c=>c.query('SELECT org_role FROM org_invites WHERE id=$1',[out.inviteId]));expect(row.rows[0].org_role).toBe('consultant');
});
it('rejects another authenticated account without consuming the personal invitation',async()=>{
 const out=await inviteOrgMember({repo},{...ctx,email,orgRole:'consultant',teamId:null});
 const deps={repo,hasher:fakeHasher,sessions:fakeSessions(),tokens:fakeTokens()};
 await expect(activateOrgMember(deps,{token:out.token!,mode:'existing-account',profile:null,existingUserId:other,untrustedClaims:NO_CLAIMS})).rejects.toMatchObject({reasonCode:'INVITE_NOT_FOUND'});
 const accepted=await activateOrgMember(deps,{token:out.token!,mode:'existing-account',profile:null,existingUserId:member,untrustedClaims:NO_CLAIMS});expect(accepted.userId).toBe(member);expect(accepted.orgRole).toBe('consultant');
});
it('accepts a shared invitation with an existing authenticated account only once',async()=>{
 const out=await createOrgInviteLink({repo:links},{...ctx,orgRole:'admin',expiry:'7d',maxUses:1});
 expect(out.status).toBe('active');
 const accept=()=>links.activate({tokenHash:hashOrgInviteLinkToken(out.linkToken!),email:'',now:new Date(),newAccount:null,existingUserId:member});
 const first=await accept();expect(first).toMatchObject({ok:true,grant:{userId:member,orgRole:'consultant'}});
 const again=await accept();expect(again).toMatchObject({ok:true,grant:{userId:member}});
 const row=await asOwner(c=>c.query('SELECT used_count FROM org_invite_links WHERE id=$1',[out.linkId]));expect(row.rows[0].used_count).toBe(1);
});

it('delivers through transactional mail and records provider acceptance without exposing the token to administrators',async()=>{
 const {OrgInvitationMailDelivery}=await import('../../src/infrastructure/auth/org-invitation-mail-delivery');
 const out=await inviteOrgMember({repo},{...ctx,email,orgRole:'consultant',teamId:null});
 const sent:{to:string;subject:string;text:string}[]=[];
 const delivery=new OrgInvitationMailDelivery(db,{send:async msg=>{sent.push(msg);return {};}},{get:()=> 'https://app.workspacex.cn'});
 await delivery.deliver({orgId:ctx.orgId,inviteId:out.inviteId,token:out.token!});
 expect(sent).toHaveLength(1);expect(sent[0]!.to).toBe(email);expect(sent[0]!.text).toContain(`https://app.workspacex.cn/auth/activate?t=${out.token}`);
 const row=await asOwner(c=>c.query('SELECT status,sent_at FROM org_invites WHERE id=$1',[out.inviteId]));expect(row.rows[0].status).toBe('pending');expect(row.rows[0].sent_at).toBeTruthy();
});
it('records mail failure, invalidates its bearer and can resend a fresh ordinary invitation',async()=>{
 const {OrgInvitationMailDelivery}=await import('../../src/infrastructure/auth/org-invitation-mail-delivery');
 const {resendOrgInvite}=await import('../../src/application/auth/resend-org-invite');
 const out=await inviteOrgMember({repo},{...ctx,email,orgRole:'consultant',teamId:null});
 const delivery=new OrgInvitationMailDelivery(db,{send:async()=>{throw Error('provider unavailable');}},{get:()=> 'https://app.workspacex.cn'});
 await expect(delivery.deliver({orgId:ctx.orgId,inviteId:out.inviteId,token:out.token!})).rejects.toMatchObject({reasonCode:'MAIL_UNAVAILABLE'});
 const row=await asOwner(c=>c.query('SELECT status,sent_at FROM org_invites WHERE id=$1',[out.inviteId]));expect(row.rows[0]).toMatchObject({status:'send-failed',sent_at:null});
 const deps={repo,hasher:fakeHasher,sessions:fakeSessions(),tokens:fakeTokens()};
 await expect(activateOrgMember(deps,{token:out.token!,mode:'existing-account',profile:null,existingUserId:member,untrustedClaims:NO_CLAIMS})).rejects.toMatchObject({reasonCode:'INVITE_NOT_FOUND'});
 await asOwner(c=>c.query("UPDATE org_invite_tokens SET issued_at=now()-interval '2 minutes' WHERE invite_id=$1",[out.inviteId]));
 const resent=await resendOrgInvite({repo},{...ctx,inviteId:out.inviteId});expect(resent.activationToken).not.toBe(out.token);
 const good=new OrgInvitationMailDelivery(db,{send:async()=>({})},{get:()=> 'https://app.workspacex.cn'});await good.deliver({orgId:ctx.orgId,inviteId:out.inviteId,token:resent.activationToken});
 expect((await activateOrgMember(deps,{token:resent.activationToken,mode:'existing-account',profile:null,existingUserId:member,untrustedClaims:NO_CLAIMS})).orgRole).toBe('consultant');
});
it('allows a legacy awaiting-review invitation to resend without any reviewer and never grants admin',async()=>{
 const {resendOrgInvite}=await import('../../src/application/auth/resend-org-invite');
 await asOwner(c=>c.query("INSERT INTO org_invites(id,org_id,email,org_role,status,invited_by) VALUES('oi-legacy-6316',$1,$2,'admin','awaiting-review',$3)",[ORG,email,admin]));
 const out=await resendOrgInvite({repo},{...ctx,inviteId:'oi-legacy-6316'});
 const accepted=await activateOrgMember({repo,hasher:fakeHasher,sessions:fakeSessions(),tokens:fakeTokens()},{token:out.activationToken,mode:'existing-account',profile:null,existingUserId:member,untrustedClaims:NO_CLAIMS});expect(accepted.orgRole).toBe('consultant');
});
it('serializes concurrent shared acceptance and spends only one use',async()=>{
 const out=await createOrgInviteLink({repo:links},{...ctx,orgRole:'consultant',expiry:'7d',maxUses:1});
 const input={tokenHash:hashOrgInviteLinkToken(out.linkToken!),email:'',now:new Date(),newAccount:null,existingUserId:member};
 const results=await Promise.all([links.activate(input),links.activate(input)]);expect(results.every(r=>r.ok)).toBe(true);
 const rows=await asOwner(c=>c.query('SELECT used_count FROM org_invite_links WHERE id=$1',[out.linkId]));expect(rows.rows[0].used_count).toBe(1);
});
