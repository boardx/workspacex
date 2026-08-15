import { interrupt } from "@langchain/langgraph";
import type {
  CommitDigitalInterviewStepResult,
  ConfirmationNodeName,
  DigitalInterviewEffects,
} from "./digital-interview-effects.port";
import type {
  DigitalInterviewCommand,
  DigitalInterviewGraphState,
} from "./digital-interview-state";

function operationId(
  state: DigitalInterviewGraphState,
  nodeName: ConfirmationNodeName | "generate_expert_candidates" | "generate_questions",
  requestId: string,
): string {
  return `${state.interviewId}:${nodeName}:${state.revisionNumber}:${requestId}`;
}

function statePatch(result: CommitDigitalInterviewStepResult): Partial<DigitalInterviewGraphState> {
  return {
    revisionId: result.revisionId,
    revisionNumber: result.revisionNumber,
    currentStep: result.currentStep,
    topicVersionId: result.topicVersionId,
    expertSnapshotVersionId: result.expertSnapshotVersionId,
    questionVersionId: result.questionVersionId,
    skillThreadId: result.skillThreadId,
    lastOperationId: result.operationId,
    lastRequestId: result.requestId,
    aggregateVersion: result.aggregateVersion,
    command: null,
    errorCode: null,
  };
}

export function createConfirmationNode(
  nodeName: ConfirmationNodeName,
  effects: DigitalInterviewEffects,
) {
  return async (state: DigitalInterviewGraphState): Promise<Partial<DigitalInterviewGraphState>> => {
    const command = interrupt({ nodeName, currentStep: state.currentStep }) as DigitalInterviewCommand;
    if (command.kind !== nodeName) {
      return { errorCode: "DIGITAL_INTERVIEW_STEP_INVALID", command: null };
    }
    const result = await effects.commitStep({
      orgId: state.orgId,
      actorId: state.actorId,
      interviewId: state.interviewId,
      revisionId: state.revisionId,
      revisionNumber: state.revisionNumber,
      nodeName,
      command,
      operationId: operationId(state, nodeName, command.requestId),
    });
    return statePatch(result);
  };
}

export async function generateExpertCandidatesNode(
  state: DigitalInterviewGraphState,
  effects: DigitalInterviewEffects,
): Promise<Partial<DigitalInterviewGraphState>> {
  if (!state.lastRequestId) return { errorCode: "DIGITAL_INTERVIEW_STEP_INVALID" };
  await effects.generateExpertCandidates({
    orgId: state.orgId, actorId: state.actorId, interviewId: state.interviewId,
    revisionId: state.revisionId, revisionNumber: state.revisionNumber,
    expectedVersion: state.aggregateVersion, requestId: state.lastRequestId,
    operationId: operationId(state, "generate_expert_candidates", state.lastRequestId),
  });
  return { errorCode: null };
}

export async function generateQuestionsNode(
  state: DigitalInterviewGraphState,
  effects: DigitalInterviewEffects,
): Promise<Partial<DigitalInterviewGraphState>> {
  if (!state.lastRequestId) return { errorCode: "DIGITAL_INTERVIEW_STEP_INVALID" };
  await effects.generateQuestions({
    orgId: state.orgId, actorId: state.actorId, interviewId: state.interviewId,
    revisionId: state.revisionId, revisionNumber: state.revisionNumber,
    expectedVersion: state.aggregateVersion, requestId: state.lastRequestId,
    operationId: operationId(state, "generate_questions", state.lastRequestId),
  });
  return { errorCode: null };
}

export function skillRefineNode(state: DigitalInterviewGraphState): Partial<DigitalInterviewGraphState> {
  const command = state.command;
  if (command?.kind !== "skill_refine") return { errorCode: "DIGITAL_INTERVIEW_STEP_INVALID" };
  return { currentStep: command.originStep, command: null, errorCode: null };
}
