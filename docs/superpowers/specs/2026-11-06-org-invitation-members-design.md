# Organization invitation and member defaults

User request (issue #6316): remove invitation approval; invitees are ordinary members, receive an email and explicitly accept; existing accounts can log in and join via invitation; enterprise members have a monthly default 1000 credit limit adjustable by admins; remove organization overview live-data badges. User explicitly authorized skipping COORD_GATEWAY_URL.

Use existing consultant org role for ordinary membership, no new platform privileges. New email/shared invitations always record consultant, irrespective of legacy clients' requested role. Legacy awaiting-review email invitations can be resent as ordinary members, invalidating old tokens. Legacy review endpoints must no longer grant admin. Existing active shared links retain recorded role (no unrequested privilege change), but new links ordinary.

Reuse transactional mail transport + canonical app public URL. Mark delivery failure accurately and allow resend; no token in successful email invitation response. Provider acceptance is not inbox delivery. Email acceptance for an existing account must bind to authenticated user's actual credential email. Shared link acceptance binds to authenticated user; no email/user id supplied by client. Membership and use count/token consumption atomic; duplicate acceptance must not create extra memberships or count extra uses. Explicit acceptance required, never consume on GET.

Separate credit limits from token limits; reuse billing credit accounting, never mint a wallet grant. Existing explicit limits survive. Enterprise effective default is 1000 credit/month. Admin UI can adjust, including zero. Holds count against available allowance.

Approach: extend current guarded API and transaction repositories rather than creating another registration/session system. Login next preserves invitation, and standard invitation session hydration preserves account identity. Keep existing new-account signup path. Tests cover privilege, cross-account email mismatch, invalid/revoked/expired tokens, concurrency/duplicate acceptance, mail failure, credit holds and monthly boundaries, and UI affordances.
