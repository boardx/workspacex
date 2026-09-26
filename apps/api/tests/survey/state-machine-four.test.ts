import { describe, expect, it } from "vitest";
import {
  InvalidSurveyTransitionError,
  transitionSurveyStatus,
} from "../../src/domain/survey/state-machine";

describe("survey four-state lifecycle", () => {
  it("allows only the documented forward path and ready withdrawal", () => {
    expect(transitionSurveyStatus("draft", "prepare")).toBe("ready");
    expect(transitionSurveyStatus("ready", "withdraw")).toBe("draft");
    expect(transitionSurveyStatus("ready", "startCollection")).toBe(
      "collecting",
    );
    expect(transitionSurveyStatus("collecting", "close")).toBe("closed");
  });

  it.each([
    ["draft", "close"],
    ["collecting", "withdraw"],
    ["collecting", "prepare"],
    ["closed", "startCollection"],
    ["closed", "withdraw"],
  ] as const)("rejects %s → %s without inventing a state", (status, command) => {
    expect(() => transitionSurveyStatus(status, command)).toThrow(
      InvalidSurveyTransitionError,
    );
  });
});
