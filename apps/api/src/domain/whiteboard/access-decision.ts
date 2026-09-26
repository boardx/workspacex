import { identity } from "@repo/contracts";
import type { PermissionDecision } from "../identity/permission-decision";

/** Whiteboards have an explicit private owner/member ACL and never fall back to org-wide visibility. */
export function decideWhiteboardAccess(input:{decisionId:string;role:"owner"|"editor"|"viewer"|null;action:"read"|"write"}):PermissionDecision {
  const allowed=input.role!==null&&(input.action==="read"||input.role!=="viewer");
  return identity.PermissionDecision.parse({allowed,orgLayer:{role:input.role?"consultant":null,teamId:null,passed:input.role!==null},projectLayer:null,scopeLayer:{scope:"org-wide",passed:allowed},reasonCode:allowed?null:input.role?"PROJECT_ROLE_INSUFFICIENT":"NO_ORG_MEMBERSHIP",decisionId:input.decisionId});
}
