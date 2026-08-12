import { describe, expect, it } from "vitest";
import { FunAsrProtocolSession } from "../../src/infrastructure/recording/aliyun-realtime-transcription-session";

describe("Fun-ASR protocol state machine", () => {
  it("waits for task-started before PCM and waits for task-finished on finish", async () => {
    const sent: Array<string | Uint8Array> = [];
    const session = new FunAsrProtocolSession({ taskId: "task", model: "fun-asr-realtime",
      send: (value) => sent.push(value), close: () => undefined }, { onInterim: () => undefined,
      onFinal: () => undefined, onError: () => undefined });
    session.start();
    session.pushAudio(new Uint8Array([1, 2]));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0] as string).header.action).toBe("run-task");
    session.accept({ header: { event: "task-started", task_id: "task" }, payload: {} });
    expect(sent[1]).toEqual(new Uint8Array([1, 2]));
    const finishing = session.finish();
    expect(JSON.parse(sent[2] as string).header.action).toBe("finish-task");
    let finished = false;
    void finishing.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    session.accept({ header: { event: "task-finished", task_id: "task" }, payload: { usage: { duration: 3 } } });
    await expect(finishing).resolves.toEqual({ durationSeconds: 3 });
  });
  it("maps interim and sentence-end provider frames without leaking provider shapes", () => {
    const interim:string[]=[],finals:Array<{text:string;startMs:number;endMs:number}>=[];
    const session=new FunAsrProtocolSession({taskId:"task",model:"fun-asr-realtime",send:()=>undefined,close:()=>undefined},
      {onInterim:text=>interim.push(text),onFinal:value=>finals.push(value),onError:()=>undefined});
    session.start(); session.accept({header:{event:"task-started",task_id:"task"},payload:{}});
    session.accept({header:{event:"result-generated",task_id:"task"},payload:{output:{sentence:{text:"你好",begin_time:0,end_time:400,sentence_end:false}}}});
    session.accept({header:{event:"result-generated",task_id:"task"},payload:{output:{sentence:{text:"你好世界",begin_time:0,end_time:800,sentence_end:true}}}});
    expect(interim).toEqual(["你好"]); expect(finals).toEqual([{text:"你好世界",startMs:0,endMs:800}]);
  });
});
