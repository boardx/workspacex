import {orgAdmin} from "@repo/contracts";
import {Inject,Injectable} from '@nestjs/common';
import {ORG_INVITE_REPOSITORY} from '../../application/auth/org-invite-ports';
import {TRANSACTIONAL_MAIL_TRANSPORT,type TransactionalMailTransport} from '../../application/notifications/transactional-mail-ports';
import {APP_PUBLIC_URL_PROVIDER,type AppPublicUrlProvider} from '../../application/project/project-invitation-ports';
import type {OrgInvitationDelivery,OrgInvitationDeliveryStore} from '../../application/auth/org-invitation-delivery';
import {OrgAdminError} from '../../application/auth/org-invite-errors';
import type {OrgId} from '../../domain/org-id';

/** Reuses the configured transactional egress; never logs the bearer or claims inbox delivery. */
@Injectable()
export class OrgInvitationMailDelivery implements OrgInvitationDelivery {
 constructor(
  @Inject(ORG_INVITE_REPOSITORY) private readonly store:OrgInvitationDeliveryStore,
  @Inject(TRANSACTIONAL_MAIL_TRANSPORT) private readonly transport:TransactionalMailTransport,
  @Inject(APP_PUBLIC_URL_PROVIDER) private readonly publicUrl:AppPublicUrlProvider,
 ){}
 async deliver(input:{orgId:OrgId;inviteId:string;token:string}):Promise<void>{
  const {token}=input;
  const recipient=await this.store.findDeliveryRecipient(input);
  if(!recipient)throw new OrgAdminError('INVITE_NOT_FOUND');
  let delivered=false;
  try{
   const url=new URL(orgAdmin.INVITATION_ACTIVATION_PATH,this.publicUrl.get());url.searchParams.set(orgAdmin.INVITATION_TOKEN_PARAM,token);
   await this.transport.send({to:recipient.email,subject:'邀请你加入 WorkspaceX 组织',text:`你收到了一份组织成员邀请。请打开以下链接，注册或登录后确认加入：\n${url.toString()}\n若你不希望加入，请忽略本邮件。`});
   delivered=true;
  }catch{
   // Persist a coarse outcome only; provider errors may contain request data and bearer URLs.
  }
  await this.store.recordDeliveryOutcome({...input,delivered});
  if(!delivered)throw new OrgAdminError('MAIL_UNAVAILABLE');
 }
}
