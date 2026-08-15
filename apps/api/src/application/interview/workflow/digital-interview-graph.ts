import { END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { DigitalInterviewEffects } from "./digital-interview-effects.port";
import {
  DigitalInterviewStateAnnotation,
  type DigitalInterviewGraphState,
} from "./digital-interview-state";
import {
  createConfirmationNode,
  generateExpertCandidatesNode,
  generateQuestionsNode,
  skillRefineNode,
} from "./digital-interview-nodes";

type Route = "confirm_topic" | "confirm_experts" | "confirm_questions" | "skill_refine" | "done";

function route(state: DigitalInterviewGraphState): Route {
  if (state.command?.kind === "skill_refine") return "skill_refine";
  if (state.currentStep === "topic") return "confirm_topic";
  if (state.currentStep === "experts") return "confirm_experts";
  if (state.currentStep === "questions") return "confirm_questions";
  return "done";
}

export function createDigitalInterviewGraph(input: {
  readonly effects: DigitalInterviewEffects;
  readonly checkpointer: BaseCheckpointSaver;
}) {
  return new StateGraph(DigitalInterviewStateAnnotation)
    .addNode("route", async () => ({}))
    .addNode("confirm_topic", createConfirmationNode("confirm_topic", input.effects))
    .addNode("generate_expert_candidates", async () => generateExpertCandidatesNode())
    .addNode("confirm_experts", createConfirmationNode("confirm_experts", input.effects))
    .addNode("generate_questions", async () => generateQuestionsNode())
    .addNode("confirm_questions", createConfirmationNode("confirm_questions", input.effects))
    .addNode("skill_refine", async (state) => skillRefineNode(state))
    .addEdge(START, "route")
    .addConditionalEdges("route", route, {
      confirm_topic: "confirm_topic",
      confirm_experts: "confirm_experts",
      confirm_questions: "confirm_questions",
      skill_refine: "skill_refine",
      done: END,
    })
    .addEdge("confirm_topic", "generate_expert_candidates")
    .addEdge("generate_expert_candidates", "confirm_experts")
    .addEdge("confirm_experts", "generate_questions")
    .addEdge("generate_questions", "confirm_questions")
    .addEdge("confirm_questions", END)
    .addEdge("skill_refine", END)
    .compile({ checkpointer: input.checkpointer });
}
