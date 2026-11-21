"use client";
import * as React from "react";

type Reference = { stageId: number; revision: number };
export type AidtReportReviewView = {
  preview: boolean;
  reviewRevision: number | null;
  setPreview: (value: boolean) => void;
  review: () => void;
  clearReview: () => void;
  takeReview: () => boolean;
};

/** Project-owned UI state survives Chat's loading/success host remount.
 * It grants no permission and never persists a report, token or confirmation.
 */
export function useAidtReportReview({ scope, serverRevision, markdown, sources, selectedSources, canConfirm, initialPreview = false }: {
  scope: string;
  serverRevision: number | null;
  markdown: string;
  sources: readonly Reference[];
  selectedSources: readonly Reference[];
  canConfirm: boolean;
  initialPreview?: boolean;
}): AidtReportReviewView {
  const proof = JSON.stringify([serverRevision, markdown, sources, selectedSources, canConfirm]);
  const [, refresh] = React.useReducer(value => value + 1, 0);
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const state = React.useRef({ scope, proof, generation: 0, proofGeneration: 0, preview: initialPreview, reviewed: null as number | null });
  if (state.current.scope !== scope) {
    state.current = { scope, proof, generation: state.current.generation + 1, proofGeneration: state.current.proofGeneration + 1, preview: initialPreview, reviewed: null };
  } else if (state.current.proof !== proof) {
    state.current = { ...state.current, proof, proofGeneration: state.current.proofGeneration + 1, reviewed: null };
  }
  const { generation, proofGeneration } = state.current;
  const current = () => active.current && state.current.generation === generation && state.current.proofGeneration === proofGeneration;
  const clearReview = () => { if (!current()) return; state.current.reviewed = null; refresh(); };
  return {
    preview: state.current.preview,
    reviewRevision: state.current.reviewed === proofGeneration ? serverRevision : null,
    setPreview: value => { if (!current()) return; if (state.current.preview !== value) state.current.proofGeneration++; state.current.preview = value; state.current.reviewed = null; refresh(); },
    review: () => { if (!current() || !state.current.preview || !canConfirm || serverRevision === null) return; state.current.reviewed = proofGeneration; refresh(); },
    clearReview,
    takeReview: () => {
      if (!current() || !state.current.preview || !canConfirm || serverRevision === null || state.current.reviewed !== proofGeneration) return false;
      state.current.reviewed = null; refresh(); return true;
    },
  };
}
