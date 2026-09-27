import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createWhiteboardDocument, executeCommands, readObjects } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";
import type { WhiteboardCommentThread } from "@repo/contracts/whiteboard-collaboration";

const comments=vi.hoisted(()=>({threads:[] as WhiteboardCommentThread[]}));
vi.mock("@/components/whiteboard/board-comments",()=>({
  listBoardMentionableMembers:vi.fn(async()=>[{userId:"peer-1",displayName:"Grace"}]),
  listBoardCommentThreads:vi.fn(async()=>structuredClone(comments.threads)),
  dispatchBoardCommentCommand:vi.fn(async(boardId:string,command:any)=>{
    const now="2026-09-26T00:00:00.000Z";
    if(command.type==="create-comment")comments.threads=[{id:command.threadId,boardId,objectId:command.objectId,worldPosition:command.worldPosition??null,status:"open",revision:1,resolvedBy:null,resolvedAt:null,archivedAt:null,comments:[{id:command.commentId,threadId:command.threadId,boardId,objectId:command.objectId,worldPosition:command.worldPosition??null,parentCommentId:null,authorId:"owner-1",body:command.body,mentions:command.mentions,createdAt:now,deletedAt:null}]}];
    else {const thread=comments.threads[0]!;comments.threads=[command.type==="reply"?{...thread,revision:thread.revision+1,comments:[...thread.comments,{id:command.commentId,threadId:thread.id,boardId,objectId:thread.objectId,worldPosition:thread.worldPosition,parentCommentId:thread.comments[0]!.id,authorId:"owner-1",body:command.body,mentions:command.mentions,createdAt:now,deletedAt:null}]}:{...thread,status:command.resolved?"resolved":"open",revision:thread.revision+1,resolvedBy:command.resolved?"owner-1":null,resolvedAt:command.resolved?now:null}];}
    return{operationId:crypto.randomUUID(),replayed:false,threads:structuredClone(comments.threads)};
  }),
}));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({BoardFabricSurface:({objects,onSelectionChange}:{objects:readonly BoardFabricObject[];onSelectionChange:(ids:string[],source:"canvas")=>void})=><div data-testid="mock-surface"><button data-testid="select-object" onClick={()=>onSelectionChange(objects[0]?[objects[0].id]:[],"canvas")}>select</button></div>}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver",ResizeObserverMock);
beforeEach(()=>{comments.threads=[];});afterEach(()=>vi.clearAllMocks());
const boardId="00000000-0000-4000-8000-000000000007";
const object={id:"note",kind:"sticky" as const,schemaVersion:1 as const,geometry:{x:10,y:20,width:180,height:140,rotation:0},text:"协作想法",style:{},parentId:null,orderKey:""};
const peer={actorId:"peer-1",displayName:"Grace",principalKind:"user" as const,avatarUrl:null,contributorColor:"#2563EB",cursor:{x:90,y:80},selected:["note"],editingObjectId:"note",viewport:{centerX:30,centerY:40,zoom:1,revision:1},presenting:true,followingActorId:null,expiresAt:"2099-01-01T00:00:00.000Z"};

it("renders identity/presenter presence and waits for authoritative comment results",async()=>{
  const doc=createWhiteboardDocument();executeCommands(doc,[{type:"create",object}],"fixture");
  render(<CollaborativeEditor boardId={boardId} clientId="client-1" currentUserId="owner-1" role="owner" doc={doc} readOnly={false} title="协作板" status="已同步" peers={[peer]}/>);
  expect(screen.getByLabelText("Grace的光标")).toBeVisible();expect(screen.getByLabelText("Grace正在编辑协作想法")).toHaveStyle({borderColor:"#2563EB"});expect(screen.getByRole("button",{name:/跟随Grace/})).toBeVisible();
  fireEvent.click(screen.getByTestId("select-object"));fireEvent.click(screen.getByRole("button",{name:"评论"}));fireEvent.change(screen.getByLabelText("评论内容"),{target:{value:"请 Grace 看一下"}});await waitFor(()=>expect(screen.getByRole("combobox",{name:"提及成员"})).toBeEnabled());fireEvent.change(screen.getByRole("combobox",{name:"提及成员"}),{target:{value:"Grace"}});fireEvent.keyDown(screen.getByRole("combobox",{name:"提及成员"}),{key:"Enter"});fireEvent.click(screen.getByRole("button",{name:"发布评论"}));
  await waitFor(()=>expect(screen.getByText("评论已由服务器持久化并确认。")).toBeVisible());expect(screen.getByTestId("board-comment-indicator-note")).toHaveClass("pointer-events-auto");
  expect(comments.threads[0]?.comments[0]?.mentions).toEqual([{userId:"peer-1"}]);expect(screen.getByText("@Grace")).toBeVisible();const panel=screen.getByTestId("board-comments-panel");expect(within(panel).getByText(/请 Grace 看一下/)).toBeVisible();fireEvent.change(screen.getByLabelText("评论内容"),{target:{value:"收到"}});fireEvent.click(screen.getByRole("button",{name:"回复"}));await waitFor(()=>expect(within(panel).getByText(/收到/)).toBeVisible());fireEvent.click(screen.getByRole("button",{name:"标记解决"}));await waitFor(()=>expect(within(panel).getByText("已解决")).toBeVisible());doc.destroy();
});

it("keeps peer updates outside the local undo stack",async()=>{const local=createWhiteboardDocument(),peerDoc=createWhiteboardDocument();const view=render(<CollaborativeEditor boardId={boardId} clientId="client-1" currentUserId="owner-1" doc={local} readOnly={false} role="owner" title="协作板" status="已同步"/>);executeCommands(peerDoc,[{type:"create",object:{...object,id:"remote-note"}}],"peer");Y.applyUpdate(local,Y.encodeStateAsUpdate(peerDoc),Symbol("remote"));await waitFor(()=>expect(readObjects(local).map(item=>item.id)).toEqual(["remote-note"]));fireEvent.click(screen.getByRole("button",{name:"撤销"}));expect(readObjects(local).map(item=>item.id)).toEqual(["remote-note"]);view.unmount();local.destroy();peerDoc.destroy();});
