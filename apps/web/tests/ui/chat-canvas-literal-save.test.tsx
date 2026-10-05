import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatCanvasModal } from "@/components/chat/chat-canvas-modal";

// Save transport is under test; actual rendering and file roundtrip have separate evidence.
vi.mock("@/components/canvas/canvas-stage", async () => {
  const { forwardRef } = await import("react");
  return { CanvasStage: forwardRef(() => null) };
});

it("preserves literal HTML entities in saved canvas text and the close callback", async () => {
  const onClose = vi.fn();
  const code = '模板: persona\n## 用户描述\n- 示例 &lt;button&gt; &amp; &quot;原文&quot;';
  render(<ChatCanvasModal code={code} lang="canvas" onClose={onClose} />);
  fireEvent.click(screen.getByTestId("chat-canvas-save"));
  await waitFor(() => expect(screen.getByTestId("chat-canvas-saved-source").textContent).toContain('&lt;button&gt; &amp; &quot;原文&quot;'));
  fireEvent.click(screen.getByTestId("chat-canvas-close"));
  expect(onClose).toHaveBeenCalledWith({ markdown: code });
});
