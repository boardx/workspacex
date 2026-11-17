import * as React from "react";
import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { HostRunContextProvider, useHostRunContext, type HostRunAttempt, type HostRunScope } from "@/lib/chat/host-run-context";

const scope: HostRunScope = { orgId: "org", userId: "student", sessionToken: "private-local-token", projectId: "project", threadId: "thread", task: "stage:2" };
let capture!: ReturnType<typeof useHostRunContext>["capture"];
function Consumer({ sender = scope, mounted }: { sender?: typeof scope; mounted?: () => void }) {
  capture = useHostRunContext(sender).capture; React.useEffect(() => { mounted?.(); }, [mounted]); return <textarea defaultValue="学生原稿" />;
}
function Host({ current = scope, revision = 1, data, mounted }: { current?: HostRunScope; revision?: number; data?: Record<string, unknown> | null; mounted?: () => void }) {
  return <HostRunContextProvider scope={current} forwardedProps={data === undefined ? { exampleContext: { revision } } : data}><Consumer sender={current} mounted={mounted} /></HostRunContextProvider>;
}
it("keeps ordinary Chat optional and does not invent any forwarded fields", () => {
  render(<Consumer />); const turn = capture(); expect(turn.context).toBeNull(); expect(turn.forwardedProps).toEqual({}); expect(turn.isCurrent()).toBe(true);
});
it("freezes a turn's selector through mutation, host updates and same-context retries without remounting the composer", () => {
  const data = { exampleContext: { revisions: [{ revision: 1 }] } }, mounted = vi.fn();
  const view = render(<Host data={data} mounted={mounted} />); const first = capture();
  data.exampleContext.revisions[0]!.revision = 99;
  view.rerender(<Host revision={2} mounted={mounted} />);
  expect(first.forwardedProps).toEqual({ exampleContext: { revisions: [{ revision: 1 }] } }); expect(first.isCurrent("thread")).toBe(true);
  expect(capture(first.context).forwardedProps).toEqual(first.forwardedProps); expect(capture().forwardedProps).toEqual({ exampleContext: { revision: 2 } });
  expect(mounted).toHaveBeenCalledOnce(); expect(view.container.querySelector("textarea")?.value).toBe("学生原稿");
});
it.each(["orgId", "userId", "sessionToken", "projectId", "threadId", "task"] as const)("invalidates a delayed %s A→B→A attempt and rejects its retry", field => {
  const view = render(<Host />); const old = capture();
  view.rerender(<Host current={{ ...scope, [field]: `${scope[field]}-changed` }} />); view.rerender(<Host />);
  expect(old.isCurrent("thread")).toBe(false); expect(() => capture(old.context)).toThrow("HOST_RUN_CONTEXT_UNAVAILABLE");
});
it("blocks unready, wrong-scope and reserved-field data rather than silently sending an ordinary turn", () => {
  const view = render(<Host data={null} />); expect(() => capture()).toThrow("HOST_RUN_CONTEXT_UNAVAILABLE");
  view.rerender(<Host data={{ chatThreadId: "override" }} />); expect(() => capture()).toThrow("HOST_RUN_CONTEXT_INVALID");
  view.rerender(<HostRunContextProvider scope={scope} forwardedProps={{ exampleContext: {} }}><Consumer sender={{ ...scope, projectId: "foreign" }} /></HostRunContextProvider>);
  expect(() => capture()).toThrow("HOST_RUN_CONTEXT_UNAVAILABLE");
});
it("drops a delayed resolution after unmount and checks the actual resolved thread", async () => {
  let resolve!: (id: string) => void; const thread = new Promise<string>(finish => { resolve = finish; }), dispatch = vi.fn();
  const view = render(<Host />); const turn = capture();
  const delayed = (async (attempt: HostRunAttempt) => { const id = await thread; if (attempt.isCurrent(id)) dispatch(attempt.forwardedProps); })(turn);
  expect(turn.isCurrent("foreign-thread")).toBe(false); view.unmount();
  await act(async () => { resolve("thread"); await delayed; }); expect(dispatch).not.toHaveBeenCalled();
});
it("pauses retries while host selection is unreadable without replacing their frozen selector when readiness returns", () => {
  const view = render(<Host revision={1} />); const original = capture();
  view.rerender(<Host data={null} />); expect(() => capture(original.context)).toThrow("HOST_RUN_CONTEXT_UNAVAILABLE");
  view.rerender(<Host revision={8} />); expect(capture(original.context).forwardedProps).toEqual({exampleContext:{revision:1}});
});

it("an explicit new attempt clears old receipt ownership while late old reads/restores cannot claim the new turn",()=>{
 const accepted=vi.fn(),started=vi.fn();const view=render(<HostRunContextProvider scope={scope} forwardedProps={{exampleContext:{revision:1}}} onRunAccepted={accepted} onAttemptStarted={started}><Consumer/></HostRunContextProvider>);const first=capture();
 first.context!.started("client-A");first.context!.accepted({runId:"run-A",threadId:"thread",clientMessageId:"client-A"});expect(accepted).toHaveBeenCalledOnce();expect(started).toHaveBeenLastCalledWith("client-A");
 const second=capture();second.context!.started("client-B");expect(started).toHaveBeenLastCalledWith("client-B");view.rerender(<HostRunContextProvider scope={scope} forwardedProps={{exampleContext:{revision:2}}} onRunAccepted={accepted} onAttemptStarted={started}><Consumer/></HostRunContextProvider>);first.context!.accepted({runId:"run-A-late",threadId:"thread",clientMessageId:"client-A"});first.context!.accepted({runId:"old-restored",threadId:"thread",clientMessageId:null});expect(accepted).toHaveBeenCalledOnce();
 second.context!.accepted({runId:"run-B",threadId:"thread",clientMessageId:"client-B"});second.context!.accepted({runId:"run-B",threadId:"thread",clientMessageId:"client-B"});expect(accepted).toHaveBeenCalledTimes(2);second.context!.started("client-B");expect(started).toHaveBeenCalledTimes(2);view.unmount();
});
