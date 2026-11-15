import type { z } from "zod";
import type { Reason } from "@repo/contracts/project-member-chat";
export class ProjectMemberChatError extends Error {
  constructor(readonly reason: z.infer<typeof Reason>) { super(reason); this.name = "ProjectMemberChatError"; }
}
