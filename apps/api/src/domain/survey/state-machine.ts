import type { SurveyStatus } from "@repo/contracts/survey";

export type SurveyStatusCommand =
  | "prepare"
  | "withdraw"
  | "startCollection"
  | "close";

const transitions: Readonly<
  Partial<Record<SurveyStatus, Partial<Record<SurveyStatusCommand, SurveyStatus>>>>
> = {
  draft: { prepare: "ready" },
  ready: { withdraw: "draft", startCollection: "collecting" },
  collecting: { close: "closed" },
  closed: {},
};

export class InvalidSurveyTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";

  constructor(
    readonly current: SurveyStatus,
    readonly command: SurveyStatusCommand,
  ) {
    super(`Cannot ${command} a survey in ${current}`);
    this.name = "InvalidSurveyTransitionError";
  }
}

export function transitionSurveyStatus(
  current: SurveyStatus,
  command: SurveyStatusCommand,
): SurveyStatus {
  const next = transitions[current]?.[command];
  if (!next) throw new InvalidSurveyTransitionError(current, command);
  return next;
}
