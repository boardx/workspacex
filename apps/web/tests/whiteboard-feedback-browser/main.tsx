import React from 'react';
import {createRoot} from 'react-dom/client';
import {createWhiteboardDocument,executeCommands,readObjects} from '@repo/whiteboard-core';
import {CollaborativeThinkingEditor} from '../../components/whiteboard/collaborative-thinking-editor';
import '../../app/globals.css';
const doc=createWhiteboardDocument();
executeCommands(doc,['a','b'].map((id,index)=>({type:'create',object:{id,schemaVersion:1,kind:'sticky',text:id,geometry:{x:300+index*300,y:260,width:180,height:180,rotation:0},style:{fill:index?'#C6DDFF':'#FFE99A'},parentId:null,orderKey:id}})),'fixture-seed');
if(new URLSearchParams(location.search).has('spacing'))executeCommands(doc,[{type:'create',object:{id:'c',schemaVersion:1,kind:'sticky',text:'c',geometry:{x:900,y:260,width:180,height:180,rotation:0},style:{fill:'#FBC9DF'},parentId:null,orderKey:'c'}}],'fixture-seed');
// Read-only receipt hook; gestures and canonical commands remain production code.
if(new URLSearchParams(location.search).has('shape'))executeCommands(doc,[{type:'create',object:{id:'shape',schemaVersion:1,kind:'rectangle',text:'',geometry:{x:900,y:300,width:180,height:140,rotation:0},style:{fill:'#BFE7CB',stroke:'#18181B'},extensionData:{contentObject:{version:1,type:'shape',variant:'rectangle',fill:'#BFE7CB',borderColor:'#18181B',borderWidth:2,borderStyle:'solid',radius:0,opacity:1,textColor:'#18181B',horizontalAlign:'center',verticalAlign:'middle'}},parentId:null,orderKey:'shape'}}],'fixture-seed');
Object.assign(window,{feedbackSnapshot:()=>structuredClone(readObjects(doc))});
createRoot(document.getElementById('root')!).render(<div style={{width:'100vw',height:'100vh'}}><CollaborativeThinkingEditor boardId="22222222-2222-4222-8222-222222222222" clientId="feedback-browser" doc={doc} readOnly={false} role="owner" title="白板反馈验收" status="本地组件验收"/></div>);
