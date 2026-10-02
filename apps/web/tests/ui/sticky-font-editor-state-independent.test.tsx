import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {ThinkingInputEditor} from "@/components/whiteboard/thinking-input-editor";
import type {BoardFabricObject} from "@/components/whiteboard/fabric/board-fabric-object";

it("preserves dirty textarea selection and scroll state across asynchronous font-ready and loadingdone", async () => {
  const previous=Object.getOwnPropertyDescriptor(document,"fonts"),events=new EventTarget();
  let resolveReady!:()=>void;
  const ready=new Promise<void>(resolve=>{resolveReady=resolve;});
  Object.defineProperty(document,"fonts",{configurable:true,value:Object.assign(events,{ready})});
  const object:BoardFabricObject={id:"independent-font",kind:"sticky",revision:1,orderKey:"a",geometry:{x:60,y:80,width:180,height:180,rotation:37},sticky:{variant:"circle",sizingMode:"fixed"},style:{fill:"#FFE89A",textColor:"#000000",fontSize:20},content:{text:"original"}};
  const before=structuredClone(object),live=vi.fn(()=>true),commit=vi.fn(()=>true),preserve=vi.fn();
  const draft=`${"long 中文 line with preserved text\n".repeat(80)}TAIL`;
  let view:ReturnType<typeof render>|undefined;
  try {
    view=render(<ThinkingInputEditor object={object} initialValue="original" viewport={{zoom:1.65,panX:30,panY:-20,fitRequest:0}} readOnly={false} onLiveCommit={live} onCommit={commit} onCancel={vi.fn()} onContinue={vi.fn()} onPreserveDraft={preserve}/>);
    const input=screen.getByTestId("board-thinking-editor") as HTMLTextAreaElement;
    await waitFor(()=>expect(document.activeElement).toBe(input));
    vi.useFakeTimers();
    fireEvent.change(input,{target:{value:draft}});
    input.setSelectionRange(draft.length-10,draft.length-2,"backward");input.scrollTop=64;
    await act(async()=>{resolveReady();await ready;await Promise.resolve();});
    act(()=>events.dispatchEvent(new Event("loadingdone")));
    expect(screen.getByTestId("board-thinking-editor")).toBe(input);
    expect(input.value).toBe(draft);expect(input.selectionStart).toBe(draft.length-10);expect(input.selectionEnd).toBe(draft.length-2);
    expect(input.selectionDirection).toBe("backward");expect(input.scrollTop).toBe(64);
    expect(live).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();expect(object).toEqual(before);
    view.unmount();view=undefined;expect(preserve).toHaveBeenCalledWith(draft);
    act(()=>events.dispatchEvent(new Event("loadingdone")));expect(live).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();
  } finally {
    view?.unmount();vi.useRealTimers();
    if(previous)Object.defineProperty(document,"fonts",previous);else Reflect.deleteProperty(document,"fonts");
  }
});
