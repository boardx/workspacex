"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  BoardObjectAuthoringPreview,
  isBoardObjectAuthoringScene,
} from "@/components/whiteboard/authoring-preview/board-object-authoring-preview";

export default function BoardObjectAuthoringPreviewPage() {
  return (
    <React.Suspense fallback={<div className="h-dvh bg-background" data-testid="loading" />}>
      <PreviewFromQuery />
    </React.Suspense>
  );
}

function PreviewFromQuery() {
  const params = useSearchParams();
  const requested = params?.get("state");
  const scene = isBoardObjectAuthoringScene(requested) ? requested : "default";
  return <BoardObjectAuthoringPreview initialScene={scene} />;
}
