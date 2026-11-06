import type {OrgId} from '../../domain/org-id';
/** Actual provider delivery; a failure must persist send-failed and reject the operation. */
export interface OrgInvitationDelivery {
  deliver(input:{orgId:OrgId;inviteId:string;token:string}):Promise<void>;
}
export const ORG_INVITATION_DELIVERY=Symbol('OrgInvitationDelivery');
