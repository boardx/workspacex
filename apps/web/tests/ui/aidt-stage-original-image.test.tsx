import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StageContent } from "@repo/contracts/aidt-stages";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtResearchMaterialReference } from "@/features/aidt/lib/aidt-research-materials";
const mocks = vi.hoisted(() => ({ print: vi.fn() }));
const original: AidtResearchMaterialReference = { projectId: "p", artifactId: "actual-artifact", runId: "actual-run", versionId: "actual-version", name: "教学图片.png", mime: "image/png", sha256: "a".repeat(64), bytes: 12 };
vi.mock("@/lib/research-report-export", () => ({ printResearchPdf: mocks.print }));
vi.mock("@/features/aidt/components/aidt-image-attachment-picker", () => ({ AidtImageAttachmentPreview: () => null, AidtImageAttachmentPicker: () => null }));
vi.mock("@/features/aidt/components/aidt-research-material", () => ({
  AidtResearchMaterialControl: ({ label, onChange }: { label: string; onChange: (value: AidtResearchMaterialReference) => void }) => <button onClick={() => onChange(original)}>选原件{label}</button>,
  AidtResearchMaterialPreview: ({ onImageState }: { onImageState?: (value: { src: string; failed: false }) => void }) => { const notify = React.useRef(onImageState); notify.current = onImageState; React.useEffect(() => { notify.current?.({ src: "blob:verified-original", failed: false }); }, []); return <p>真实源adapter已就绪（受控测试）</p>; },
}));
function Host() {
  const [draft, update] = React.useState<AidtUiStageDraft>({ fields: {}, selectedIdeaId: "one", ideas: ["one", "two", "three"].map((id, index) => ({ id, title: `点子${index + 1}`, description: "先体验。再比较。", image: "data:image/png;base64,local", imageName: "临时图.png" })) });
  return <><AidtStageOutput projectId="p" step={AIDT_STEPS[3]!} draft={draft} update={update} readOnly={false} toolHref={() => "/"} /><output data-testid="raw-state">{JSON.stringify(draft)}</output></>;
}
const snapshot = () => JSON.parse(screen.getByTestId("raw-state").textContent!) as AidtUiStageDraft;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("persists a real file-version reference separately from Chat attachments and previews the exact source", async () => {
  render(<Host />); fireEvent.click(screen.getByRole("button", { name: "选原件候选1原始图片" }));
  const saved = StageContent.parse({ schemaVersion: 1, draft: { ...snapshot(), ideas: snapshot().ideas.map(idea => ({ ...idea, image: "" })) } });
  expect(JSON.parse(saved.draft.fields["ideaFile:one"]!)).toEqual(original);
  expect(saved.draft.ideas[0]?.imageAttachment).toBeUndefined(); expect(saved.draft.ideas[0]?.image).toBe("");
  fireEvent.click(screen.getByRole("checkbox", { name: /本组已比较：/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "描述单 PDF 预览" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "描述单 PDF 预览" }));
  const sheet = screen.getAllByTestId("aidt-idea-sheet")[0]!;
  expect(sheet).toHaveTextContent("原始图片来源：教学图片.png"); expect(sheet).toHaveTextContent("actual-version");
  expect(sheet.querySelector("img")).toHaveAttribute("src", "blob:verified-original");
});
it("does not let a late local FileReader overwrite a subsequently selected stored original", () => {
  let finish!: () => void;
  vi.stubGlobal("FileReader", class { result = "data:image/png;base64,late"; onload?: () => void; readAsDataURL() { finish = () => this.onload?.(); } });
  render(<Host />);
  fireEvent.change(screen.getByLabelText("候选1参考图"), { target: { files: [new File(["x"], "late.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: "选原件候选1原始图片" })); act(() => finish());
  expect(JSON.parse(snapshot().fields["ideaFile:one"]!)).toEqual(original);
  expect(snapshot().ideas[0]?.image).toBe("");
});
