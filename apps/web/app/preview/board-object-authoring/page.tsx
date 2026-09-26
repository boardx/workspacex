"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  BoardObjectAuthoringPreview,
  resolveBoardObjectAuthoringScene,
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
  const scene = resolveBoardObjectAuthoringScene(params?.get("state"));
  return <BoardObjectAuthoringPreview initialScene={scene} />;
}
