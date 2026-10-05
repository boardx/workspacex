import React,{useState} from 'react';
import{createRoot}from'react-dom/client';
import{createWhiteboardDocument}from'@repo/whiteboard-core';
import{CollaborativeThinkingEditor}from'../../components/whiteboard/collaborative-thinking-editor';
import{BoardImportPanel}from'../../components/whiteboard/board-import-panel';
import'../../app/globals.css';
const doc=createWhiteboardDocument(),boardId='22222222-2222-4222-8222-222222222222';
function Shell(){const[open,setOpen]=useState(false);return <div style={{width:'100vw',height:'100vh','--font-sans':'system-ui'}as React.CSSProperties}><CollaborativeThinkingEditor doc={doc}boardId={boardId}clientId="audit-import"role="owner"readOnly={false}title="Import shell"status="Import controls audit"onImport={()=>setOpen(true)}/>{open&&<div className="fixed inset-0 z-[70] pointer-events-none [&>aside]:pointer-events-auto"><BoardImportPanel boardId={boardId}expectedEpoch={1}onClose={()=>setOpen(false)}/></div>}</div>}
createRoot(document.getElementById('root')!).render(<Shell/>);
