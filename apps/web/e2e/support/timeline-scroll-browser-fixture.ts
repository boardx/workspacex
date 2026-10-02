import { createRequire } from "node:module";
import path from "node:path";

/** Real React/DOM fixture; executes the production hook, never a rewritten scroll algorithm. */
export async function timelineScrollBrowserFixture(): Promise<string> {
  const webRoot = path.resolve(__dirname, "../..");
  const require = createRequire(path.join(webRoot, "package.json"));
  // tsx owns the pinned esbuild installation used by the repository toolchain.
  const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
  const hook = path.join(webRoot, "lib/chat-workbench/use-timeline-scroll.ts");
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {useTimelineScroll} from ${JSON.stringify(hook)};
function App(){const [revision,setRevision]=React.useState(0);const s=useTimelineScroll(revision);
return React.createElement('div',null,
React.createElement('div',{id:'messages',tabIndex:0,ref:s.messagesContainerRef,onScroll:s.handleMessagesScroll,onWheel:s.handleUserScrollIntent,onKeyDown:s.handleUserScrollIntent,onPointerDown:s.handleUserScrollIntent,onTouchStart:s.handleUserScrollIntent,style:{height:'200px',overflow:'auto',overflowAnchor:'none'}},
React.createElement('div',{ref:s.messagesContentRef,style:{height:(255+revision)+'px',background:'linear-gradient(white,grey)'}},React.createElement('span',{id:'anchor'},'reading anchor'))),
React.createElement('span',{id:'following'},String(s.isAtBottom)),
React.createElement('button',{id:'grow',onClick:()=>setRevision(x=>x+1)},'stream next delta'),
React.createElement('button',{id:'jump',onClick:()=>s.scrollMessagesToBottom('auto')},'jump to latest'));}
createRoot(document.getElementById('root')).render(React.createElement(App));`;
  const result = await build({ stdin: { contents: source, resolveDir: webRoot, loader: "tsx" }, bundle: true, write: false, platform: "browser", alias: { "@": webRoot }, define: { "process.env.NODE_ENV": '"production"' } });
  return result.outputFiles[0].text;
}
