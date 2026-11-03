import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
/** Unique actor and org; reuse the canonical isolation identity rather than another scope algorithm. */
export const ABOUT_ME_E2E = {
  orgId: `about-${F.orgId}`,
  projectId: `about-${F.projectId}`,
  userId: `about-${F.userId}`,
  email: `about-${F.email}`,
  password: F.password,
  threadId: `about-thread-${F.userId}`,
  sourceGoalId: `source-about-goal-${F.userId}`,
  sourceTodoId: `source-about-todo-${F.userId}`,
  goalText: "原文目标 {goal}",
  todoText: "原文待办 {todo}",
  threadTitle: "原文来源 {thread}",
} as const;
