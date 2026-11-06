import {orgAdmin} from "@repo/contracts";
import {Inject,Injectable} from '@nestjs/common';
import {DATABASE_PORT,type DatabasePort} from '../../application/ports/database.port';
import {TRANSACTIONAL_MAIL_TRANSPORT,type TransactionalMailTransport} from '../../application/notifications/transactional-mail-ports';
import {APP_PUBLIC_URL_PROVIDER,type AppPublicUrlProvider} from '../../application/project/project-invitation-ports';
import type {OrgInvitationDelivery} from '../../application/auth/org-invitation-delivery';
import {OrgAdminError} from '../../application/auth/org-invite-errors';
import type {OrgId} from '../../domain/org-id';

/** Reuses the configured transactional egress; never logs the bearer or claims inbox delivery. */
@Injectable()
export class OrgInvitationMailDelivery implements OrgInvitationDelivery {
 constructor(
  @Inject(DATABASE_PORT) private readonly db:DatabasePort,
  @Inject(TRANSACTIONAL_MAIL_TRANSPORT) private readonly transport:TransactionalMailTransport,
  @Inject(APP_PUBLIC_URL_PROVIDER) private readonly publicUrl:AppPublicUrlProvider,
 ){}
 async deliver(input:{orgId:OrgId;inviteId:string;token:string}):Promise<void>{
  const {orgId,inviteId,token}=input;
  const recipient=await this.db.withTenant(orgId,async s=>(await s.query<{email:string}>(
   `SELECT i.email FROM org_invites i JOIN org_invite_tokens t ON t.invite_id=i.id
    WHERE i.id=$1 AND i.org_id=$2 AND i.status='pending' AND t.token=$3 AND t.consumed_at IS NULL AND t.expires_at>now()`,[inviteId,orgId,token])).rows[0]);
  if(!recipient)throw new OrgAdminError('INVITE_NOT_FOUND');
  let delivered=false;
  try{
   const url=new URL(orgAdmin.INVITATION_ACTIVATION_PATH,this.publicUrl.get());url.searchParams.set(orgAdmin.INVITATION_TOKEN_PARAM,token);
   await this.transport.send({to:recipient.email,subject:'邀请你加入 WorkspaceX 组织',text:`你收到了一份组织成员邀请。请打开以下链接，注册或登录后确认加入：\n${url.toString()}\n若你不希望加入，请忽略本邮件。`});
   delivered=true;
  }catch{
   // Persist a coarse outcome only; provider errors may contain request data and bearer URLs.
  }
  await this.db.withTenant(orgId,async s=>{
   // Serialize on invite before token, matching resend/activation; an old attempt cannot change a newer one.
   await s.query('SELECT id FROM org_invites WHERE id=$1 FOR UPDATE',[inviteId]);
   await s.query(`UPDATE org_invites i SET status=$4,sent_at=CASE WHEN $4='pending' THEN now() ELSE NULL END
    WHERE i.id=$1 AND i.org_id=$2 AND i.status='pending'
     AND EXISTS(SELECT 1 FROM org_invite_tokens t WHERE t.invite_id=i.id AND t.token=$3 AND t.consumed_at IS NULL)`,
    [inviteId,orgId,token,delivered?'pending':'send-failed']);
   if(!delivered)await s.query('UPDATE org_invite_tokens SET consumed_at=now() WHERE invite_id=$1 AND token=$2 AND consumed_at IS NULL',[inviteId,token]);
  });
  if(!delivered)throw new OrgAdminError('MAIL_UNAVAILABLE');
 }
}
