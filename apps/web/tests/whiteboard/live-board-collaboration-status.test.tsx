import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WhiteboardConnectionState } from "@/lib/whiteboard-provider";

const harness = vi.hoisted(() => ({ state: null as ((value: WhiteboardConnectionState) => void) | null, retry: vi.fn(), close: vi.fn(), update:vi.fn(), confirm:vi.fn(), editor:null as null|{organizeFitRequest?:unknown;followViewport:unknown;onManualViewportChange:()=>void} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams:()=>new URLSearchParams() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { userId: "owner-1" } }) }));
vi.mock("@/lib/live-whiteboard", () => ({ getBoard: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000007", name: "协作板", ownerId: "owner-1", role: "owner", archived: false, createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z" })) }));
vi.mock("@/lib/whiteboard-provider", () => ({ WhiteboardProvider: class { constructor(_doc: unknown, _id: string, callback: (value: WhiteboardConnectionState) => void) { harness.state = callback; } awareness() {} retryNow = harness.retry; close = harness.close; } }));
vi.mock("@/components/whiteboard/collaborative-editor", () => ({ CollaborativeEditor: (props: { dockExtension?:React.ReactNode;status:string;commentsReadOnly:boolean;organizeFitRequest?:unknown;followViewport:unknown;onManualViewportChange:()=>void }) => {harness.editor=props;return <div data-testid="editor-status" data-comments-readonly={String(props.commentsReadOnly)}>{props.status}{props.dockExtension}</div>;} }));
vi.mock("@/components/whiteboard/board-organize-controls",()=>({BoardOrganizeControls:({onProposal}:{onProposal:(value:unknown)=>void})=><button onClick={()=>onProposal({proposalId:'local-proposal'})}>Generate test proposal</button>}));
vi.mock("@/components/whiteboard/board-presentation-controls",()=>({BoardPresentationControls:()=>null}));
vi.mock("@/lib/whiteboard-operation-client",()=>({readPresentation:vi.fn(async()=>({revision:3,presenterId:'presenter',followers:['owner-1'],viewport:{x:300,y:200,zoom:2}})),updatePresentation:(...args:unknown[])=>harness.update(...args),readAIProposal:vi.fn(),joinBoardRoom:vi.fn(),recordBoardUndoReceipt:vi.fn(),confirmAIProposal:(...args:unknown[])=>harness.confirm(...args),cancelAIProposal:vi.fn()}));

vi.mock("@/components/whiteboard/board-ai-proposal-panel",()=>({BoardAIProposalPanel:({onConfirm}:{onConfirm:()=>void})=><button onClick={onConfirm}>Confirm test proposal</button>}));
import { LiveBoard } from "@/components/whiteboard/live-board";
const online: WhiteboardConnectionState = { phase: "online", pending: 0, role: "owner", archived: false, peers: [], reason: null, epoch:1, retryAttempt: 0, duplicateAcks: 0, lastAckSequence: 12, lastAckReceipt:null };

beforeEach(() => { harness.state = null; harness.retry.mockClear(); harness.close.mockClear();harness.update.mockReset().mockResolvedValue({revision:4,presenterId:"presenter",followers:[],viewport:{x:300,y:200,zoom:2}});harness.editor=null; });

it("makes pending, retry and duplicate ACK recovery state visible and actionable", async () => {
  render(<LiveBoard boardId="00000000-0000-4000-8000-000000000007" />);
  await waitFor(() => expect(harness.state).not.toBeNull());
  expect(screen.getByTestId("board-sync-banner")).toHaveClass("shrink-0","relative");
  expect(screen.getByTestId("board-editor-region")).toHaveClass("relative","overflow-hidden");
  expect(screen.getByTestId("board-sync-banner")).toHaveTextContent("加密保存在此浏览器");
  harness.state?.({ ...online, phase: "offline", pending: 3, reason: "CONNECTION_LOST", retryAttempt: 2, duplicateAcks: 1 });
  expect(await screen.findByTestId("editor-status")).toHaveTextContent("第 2 次重连 · 3 项修改待确认");
  expect(screen.getByTestId("board-duplicate-ack")).toHaveTextContent("已忽略 1 个重复确认");
  fireEvent.click(screen.getByTestId("board-retry-sync")); expect(harness.retry).toHaveBeenCalledOnce();
  expect(screen.getByTestId("editor-status")).toHaveAttribute("data-comments-readonly","true");
  harness.state?.({ ...online, role:"commenter", pending: 0 });
  expect(await screen.findByTestId("editor-status")).toHaveTextContent("已同步 · 序列 12");
  expect(screen.getByTestId("editor-status")).toHaveAttribute("data-comments-readonly","false");
});

afterEach(cleanup);
it('manual navigation suppresses followed viewport immediately and sends authoritative leave-follow',async()=>{
 render(<LiveBoard boardId="00000000-0000-4000-8000-000000000007"/>);
 await waitFor(()=>expect(harness.editor?.followViewport).toEqual({x:300,y:200,zoom:2}));
 act(()=>harness.editor?.onManualViewportChange());
 expect(harness.editor?.followViewport).toBeNull();
 await waitFor(()=>expect(harness.update).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000007','default',{type:'leave-follow',actorId:'owner-1',expectedRevision:3},null));
});

it('only schedules local viewport fit after successful confirmation, never when preview arrives',async()=>{
 harness.confirm.mockResolvedValue({undoReceipt:{expectedRevision:{epoch:1,seq:13}}});
 render(<LiveBoard boardId="00000000-0000-4000-8000-000000000007"/>);
 await screen.findByText('Generate test proposal');
 expect(harness.editor?.organizeFitRequest).toBeNull();
 fireEvent.click(screen.getByText('Generate test proposal'));
 expect(harness.editor?.organizeFitRequest).toBeNull();
 fireEvent.click(screen.getByText('Confirm test proposal'));
 await waitFor(()=>expect(harness.editor?.organizeFitRequest).toEqual({id:expect.any(String),proposal:{proposalId:'local-proposal'}}));
});
