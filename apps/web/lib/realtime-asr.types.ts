import type { personalRealtimeTranscription as C } from "@repo/contracts";
import type { z } from "zod";

export type RealtimeAsrServerEvent = z.infer<typeof C.RealtimeAsrServerEvent>;
export type RealtimeAsrStreamError = z.infer<typeof C.RealtimeAsrStreamError>;
export type RealtimeAsrTicket = z.infer<typeof C.operations.issueRealtimeAsrTicket.out>;
export type RealtimeAsrFinalEvent = Extract<RealtimeAsrServerEvent, { type: "final" }>;
export type RealtimeAsrStreamState = "idle" | "connecting" | "recording" | "stopping" | "error";
