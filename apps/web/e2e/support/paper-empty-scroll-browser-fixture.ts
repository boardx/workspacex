import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

let compiled: Promise<{ script: string; css: string; fonts: string; fontRoot: string }> | undefined;

/** Isolated layout proof: actual component, hook, tokens and fonts; no API or trace scripts. */
export async function mountPaperEmptyScrollFixture(page: Page): Promise<void> {
  compiled ??= (async () => {
    const webRoot = path.resolve(__dirname, "../..");
    const require = createRequire(path.join(webRoot, "package.json"));
    const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
    const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {useTimelineScroll} from ${JSON.stringify(path.join(webRoot, "lib/chat-workbench/use-timeline-scroll.ts"))};
import {TaskWorkbenchEmptyState} from ${JSON.stringify(path.join(webRoot, "components/chat/chat-task-workbench-empty-state.tsx"))};
function Timeline(){const [messages,setMessages]=React.useState([]);const [height,setHeight]=React.useState(1600);const [brief,setBrief]=React.useState(false);const renders=React.useRef(0);renders.current++;
const s=useTimelineScroll(messages,messages.length>0);return <><div className="fixed left-0 top-0 flex gap-2">
<button id="first" onClick={()=>setMessages([{id:1}])}>first</button><button id="restore" onClick={()=>setMessages([{id:1},{id:2}])}>restore</button>
<button id="clear" onClick={()=>setMessages([])}>clear</button><button id="resize" onClick={()=>setHeight(h=>h+100)}>resize</button>
<button id="empty-grow" onClick={()=>setBrief(true)}>briefing</button>
<button id="delta" onClick={()=>{setHeight(h=>h+50);setMessages(m=>[...m,{id:m.length+1}])}}>delta</button>
<button id="jump" onClick={()=>s.scrollMessagesToBottom('auto')}>jump</button><span id="following">{String(s.isAtBottom)}</span><span id="renders">{renders.current}</span></div>
<div ref={s.messagesContainerRef} data-testid="copilotkit-v2-messages" className="relative flex-1 overflow-y-auto p-3 flex flex-col" onScroll={s.handleMessagesScroll} onWheel={s.handleUserScrollIntent} onKeyDown={s.handleUserScrollIntent} onPointerDown={s.handleUserScrollIntent} onTouchMove={s.handleUserScrollIntent}>
<div ref={s.messagesContentRef} className="mx-auto w-full max-w-3xl flex flex-1 flex-col">{messages.length===0?<TaskWorkbenchEmptyState onUseTemplate={()=>{}} materialsCount={0} skillsCount={0} briefing={brief?<div style={{height:100,flexShrink:0}}>新增会话简报</div>:undefined}/>:<div style={{height,flexShrink:0}}><p id="reading-anchor">真实 hook 的长内容阅读锚点</p></div>}</div></div></>}
function App(){const [thread,setThread]=React.useState(0);return <><button id="new" style={{position:'fixed',top:35,left:0}} onClick={()=>setThread(t=>t+1)}>new thread</button><div className="relative flex min-h-0 flex-col" style={{position:'absolute',left:16,top:106,width:343,height:366}}><Timeline key={thread}/></div></>}
createRoot(document.getElementById('root')).render(<App/>);`;
    const result = await build({ stdin: { contents: source, resolveDir: webRoot, loader: "tsx" }, bundle: true, write: false, platform: "browser", alias: { "@": webRoot }, define: { "process.env.NODE_ENV": '"production"' } });
    const loadConfig = require("tailwindcss/loadConfig");
    const config = loadConfig(path.join(webRoot, "tailwind.config.ts"));
    const css = await require("postcss")([require("tailwindcss")({ ...config, content: [{ raw: source, extension: "tsx" }, path.join(webRoot, "components/chat/chat-task-workbench-empty-state.tsx")] })])
      .process(readFileSync(path.join(webRoot, "app/globals.css"), "utf8"), { from: path.join(webRoot, "app/globals.css") });
    const fontCss = require.resolve("@fontsource-variable/noto-sans-sc/index.css");
    return { script: result.outputFiles[0].text, css: css.css, fontRoot: path.join(path.dirname(fontCss), "files"),
      fonts: readFileSync(fontCss, "utf8").replace(/url\(\.\/files\/([^)]*)\)/g, 'url(https://paper-font.invalid/$1)') };
  })();
  const fixture = await compiled;
  await page.route("https://paper-font.invalid/**", async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (!/^[a-zA-Z0-9_.-]+\.woff2$/.test(file)) return route.abort();
    await route.fulfill({ contentType: "font/woff2", headers: { "Access-Control-Allow-Origin": "*" }, body: readFileSync(path.join(fixture.fontRoot, file)) });
  });
  await page.goto("about:blank");
  await page.setContent(`<style>${fixture.fonts}\n${fixture.css}\n:root{--font-sans:'Noto Sans SC Variable'}</style><body class="font-sans"><div id="root"></div></body>`);
  await page.addScriptTag({ content: fixture.script });
  await page.waitForSelector('[data-testid="chat-task-workbench-goal-headline"]');
  const fontCount = await page.evaluate(async () => (await document.fonts.load('14px "Noto Sans SC Variable"', "今天，想完成什么？")).length);
  if (fontCount === 0) throw new Error("PAPER layout proof requires the actual packaged Chinese font");
  await page.evaluate(() => document.fonts.ready);
}
