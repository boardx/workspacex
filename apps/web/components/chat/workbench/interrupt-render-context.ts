"use client";
import { createContext } from "react";
/** The host owns write permission and the one durable pending-action surface. */
export const InterruptRenderContext = createContext<{ bearer?: string; canWrite: boolean; pendingRunId: string | null }>({ canWrite: false, pendingRunId: null });
