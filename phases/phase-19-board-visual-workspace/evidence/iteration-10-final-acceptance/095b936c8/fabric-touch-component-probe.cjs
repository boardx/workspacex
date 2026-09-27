const {createRequire}=require('node:module');
const {createServer}=require('node:http');
const root=process.argv[2];
const req=createRequire(root+'/apps/web/package.json');
const viteReq=createRequire(req.resolve('vitest/package.json'));
const esbuild=viteReq('esbuild');const {chromium}=req('@playwright/test');
(async()=>{
 const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BoardFabricSurface} from './components/whiteboard/fabric/board-fabric-surface';function App(){const [tool,setTool]=React.useState('hand');window.setBoardTool=setTool;const [v,setV]=React.useState({zoom:1,panX:0,panY:0,fitRequest:0});return <BoardFabricSurface objects={[]} selectedObjectIds={[]} readOnly={false} tool={tool} viewport={v} onDrawingComplete={input=>window.lastDrawing=input} onSelectionChange={()=>{}} onObjectTransform={()=>true} onViewportChange={setV}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root+'/apps/web',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
 const html='<html><style>html,body,#root,[data-testid="board-fabric-surface"]{margin:0;width:100%;height:100%;position:relative}#root{height:700px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style><div id="root"></div><script>'+bundle.outputFiles[0].text+'</script></html>';
 const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1000,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('canvas.upper-canvas').waitFor();const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y:300}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:300+i*10,y:300+i*5}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);const result=await page.locator('[data-testid="board-fabric-surface"]').evaluate(e=>({x:e.getAttribute('data-viewport-pan-x'),y:e.getAttribute('data-viewport-pan-y'),zoom:e.getAttribute('data-viewport-zoom')}));const results={pan:result};
 if(Number(result.x)!==80||Number(result.y)!==40||errors.length)process.exitCode=1;
 const read=()=>page.locator('[data-testid="board-fabric-surface"]').evaluate(e=>({x:Number(e.getAttribute('data-viewport-pan-x')),y:Number(e.getAttribute('data-viewport-pan-y')),zoom:Number(e.getAttribute('data-viewport-zoom'))}));
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y:300}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:320,y:320}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await page.waitForTimeout(50);results.cancel=await read();
 if(results.cancel.x!==80||results.cancel.y!==40)process.exitCode=1;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:7,x:300,y:300}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:7,x:330,y:320}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(50);results.afterCancel=await read();
 if(results.afterCancel.x!==110||results.afterCancel.y!==60)process.exitCode=1;
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await page.waitForTimeout(450);await page.mouse.move(300,300);await page.mouse.down();await page.mouse.move(340,320,{steps:4});await page.mouse.up();
 await page.waitForTimeout(50);results.mouse=await read();if(results.mouse.x!==150||results.mouse.y!==80)process.exitCode=1;
 await page.evaluate(()=>window.setBoardTool('draw-pen'));await page.waitForTimeout(50);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:300,y:300,button:'left',buttons:1,clickCount:1,pointerType:'pen',force:.2});
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:300+i*10,y:300+i*4,button:'left',buttons:1,pointerType:'pen',force:i/10});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:380,y:332,button:'left',buttons:0,clickCount:1,pointerType:'pen',force:0});
 await page.waitForTimeout(50);results.pressures=await page.evaluate(()=>window.lastDrawing?.points.map(p=>p.pressure)??[]);
 if(new Set(results.pressures).size<2)process.exitCode=1;
 if(process.argv.includes('--pinch')){
 await page.evaluate(()=>window.setBoardTool('hand'));await page.waitForTimeout(50);
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 const beforePinch=await read();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:10,x:300,y:300},{id:11,x:400,y:300}]});
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:10,x:300-i*5,y:300},{id:11,x:400+i*5,y:300}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(50);
 const afterPinch=await read();results.pinch={before:beforePinch,after:afterPinch};
 if(Math.abs(afterPinch.zoom-beforePinch.zoom*1.8)>0.001||Math.abs(afterPinch.x-(350-(350-beforePinch.x)*1.8))>0.5||Math.abs(afterPinch.y-(300-(300-beforePinch.y)*1.8))>0.5)process.exitCode=1;
 }
 console.log(JSON.stringify({scope:'real Fabric component only; no backend or physical hardware',root,results,errors}));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
