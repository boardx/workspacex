import '../../../../packages/fabric-markdown/src/templates-entry';
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { RenderedDiagramLayout } from '@repo/contracts/whiteboard-operation';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { computeRenderedLayoutHash } from '@repo/whiteboard-core';
import { SESSION_TOKEN_STORAGE_KEY } from '../../lib/api-client';
import { diagramModelFromBoardObjects } from '../../lib/board-diagram-source';
import { modelToMermaid } from '../../../../packages/fabric-markdown/src/mermaid-serializer';

/** Requires actual persisted assistant-message pages. No API/LLM response interception,
 * seeded artifact substitute or screenshots as the content oracle. Run under the root's
 * real stack after generating one flowchart, sequence and persona through Chat. */
export async function produceChatBoardThreeDiagramEvidence(input: {
  page: Page; api: APIRequestContext; apiOrigin: string; actorId: string;
  sources: { family: 'flowchart'|'sequence'|'persona'; chatUrl: string }[];
}) {
  const {page,api,apiOrigin,actorId}=input;
  expect(input.sources.map(source=>source.family).sort()).toEqual(['flowchart','persona','sequence']);
  const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);
  expect(token,'Use a real authenticated session before the producer').toBeTruthy();
  const headers={Authorization:`Bearer ${token}`};
  const evidence=[];
  for(const source of input.sources){
    const created=await api.post(`${apiOrigin}/whiteboards`,{headers,data:{requestId:randomUUID(),name:`Chat ${source.family} ${randomUUID()}`}});
    expect(created.ok(),await created.text()).toBe(true);
    const {id:boardId}=await created.json() as {id:string};
    await page.goto(source.chatUrl);
    const prefix=source.family==='persona'?'chat-canvas':'chat-diagram';
    const preview=page.getByTestId(`${prefix}-fabric`).first();
    await expect(preview.locator('canvas').first()).toBeVisible();
    await preview.getByTestId(`${prefix}-maximize`).click();
    await page.getByTestId(`${prefix}-save`).click();
    await expect(page.getByTestId(`${prefix}-saved`)).toBeVisible();
    await page.keyboard.press('Escape');
    const insert=preview.getByTestId('chat-diagram-insert-board');
    await expect(insert).toBeEnabled();
    await insert.click();
    await page.getByTestId('chat-board-target').selectOption(boardId);
    await page.getByLabel('X 坐标').fill('37'); await page.getByLabel('Y 坐标').fill('59');
    const responsePromise=page.waitForResponse(response=>response.url().endsWith(`/v1/whiteboards/${boardId}/artifact-handoffs`) && response.request().method()==='POST');
    await page.getByTestId('chat-board-handoff-confirm').click();
    const response=await responsePromise;
    expect(response.ok(),await response.text()).toBe(true);
    const request=response.request().postDataJSON() as {layout:RenderedDiagramLayout;offset:{x:number;y:number}};
    expect(request.layout.diagramKind).toBe(source.family);
    expect(request.layout.objects.length).toBeGreaterThan(1);
    const read=await api.get(`${apiOrigin}/v1/whiteboards/${boardId}/objects?actorId=${encodeURIComponent(actorId)}`,{headers});
    expect(read.ok(),await read.text()).toBe(true);
    const snapshot=await read.json() as {objects:WhiteboardObject[];revision:{epoch:number;seq:number}};
    for(const original of request.layout.objects){
      const canonical=snapshot.objects.find(object=>(object.extensionData?.content as Record<string,unknown>)?.sourceId===original.sourceId && (object.extensionData?.content as Record<string,unknown>)?.type==='artifact');
      expect(canonical,`Missing source object ${original.sourceId}`).toBeTruthy();
      expect(canonical!.text).toBe(original.text);
      expect(canonical!.geometry.x).toBeCloseTo(original.geometry.x+37,8);
      expect(canonical!.geometry.y).toBeCloseTo(original.geometry.y+59,8);
      expect(canonical!.geometry.width).toBe(original.geometry.width);
      expect(canonical!.geometry.height).toBe(original.geometry.height);
      expect(canonical!.extensionData?.content).toMatchObject({artifactId:request.layout.artifactId,sourceRevision:request.layout.sourceRevision,layoutHash:request.layout.layoutHash});
      if(original.kind==='edge') expect(canonical!.connector?.label).toBe(original.text);
    }
    // A second rendered geometry for the same immutable source must be independently
    // verified and coexist with the first binding, including in real PostgreSQL.
    const variantCreated=await api.post(`${apiOrigin}/whiteboards`,{headers,data:{requestId:randomUUID(),name:`Chat variant ${randomUUID()}`}});
    expect(variantCreated.ok()).toBe(true);
    const variantBoard=(await variantCreated.json() as {id:string}).id;
    const {layoutHash:_hash,...layoutBody}=request.layout;
    const variantBody={...layoutBody,objects:layoutBody.objects.map(object=>({...object,geometry:{...object.geometry,x:object.geometry.x+11},style:{...object.style,...(typeof object.style.fromX==='number'?{fromX:object.style.fromX+11}:{}),...(typeof object.style.toX==='number'?{toX:object.style.toX+11}:{})}}))};
    const variant={...variantBody,layoutHash:computeRenderedLayoutHash(variantBody)};
    const variantId=randomUUID(),variantRequest={requestId:variantId,expectedRevision:{epoch:1,seq:0},layout:variant,offset:{x:0,y:0}};
    const variantResponse=await api.post(`${apiOrigin}/v1/whiteboards/${variantBoard}/artifact-handoffs`,{headers,data:variantRequest});
    expect(variantResponse.ok(),await variantResponse.text()).toBe(true);
    const replay=await api.post(`${apiOrigin}/v1/whiteboards/${variantBoard}/artifact-handoffs`,{headers,data:variantRequest});
    expect(replay.ok(),await replay.text()).toBe(true);
    const conflict=await api.post(`${apiOrigin}/v1/whiteboards/${variantBoard}/artifact-handoffs`,{headers,data:{...variantRequest,layout:request.layout}});
    expect(conflict.status()).toBe(409);
    const tamperIndex=source.family==='persona'?layoutBody.objects.findIndex(object=>typeof object.style.dataJson==='string' && JSON.parse(object.style.dataJson).role==='field'):0;
    expect(tamperIndex).toBeGreaterThanOrEqual(0);
    const tamperedBody={...layoutBody,objects:layoutBody.objects.map((object,index)=>index===tamperIndex?{...object,text:object.text+' unauthorized source change'}:object)};
    const tampered=await api.post(`${apiOrigin}/v1/whiteboards/${variantBoard}/artifact-handoffs`,{headers,data:{...variantRequest,requestId:randomUUID(),layout:{...tamperedBody,layoutHash:computeRenderedLayoutHash(tamperedBody)}}});
    expect(tampered.status()).toBe(403);
    const restored=diagramModelFromBoardObjects(snapshot.objects,request.layout.artifactId);
    const code=modelToMermaid(restored);
    expect(restored.nodes).toHaveLength(request.layout.objects.filter(object=>object.kind==='node').length);
    expect(restored.edges).toHaveLength(request.layout.objects.filter(object=>object.kind==='edge').length);
    if(source.family==='sequence'){
      expect(restored.edges.length).toBeGreaterThanOrEqual(2);
      expect(new Set(restored.edges.map(edge=>edge.seqY)).size).toBeGreaterThanOrEqual(2);
      expect(snapshot.objects.some(object=>(object.extensionData?.content as Record<string,unknown>)?.type==='artifact-helper')).toBe(true);
    }
    await page.goto(`/studio/board/${boardId}`);
    await expect(page.getByTestId('board-fabric-canvas')).toBeVisible();
    await page.reload();
    const surface=page.getByTestId('board-fabric-surface');
    await expect.poll(async()=>JSON.parse(await surface.getAttribute('data-object-scenes') ?? '[]').map((object:{id:string})=>object.id).sort()).toEqual(snapshot.objects.map(object=>object.id).sort());
    await page.getByTestId('board-zoom-fit-board').click();
    const paintedNode=snapshot.objects.find(object=>object.kind!=='connector' && object.text.trim().length>0)!;
    expect(paintedNode).toBeTruthy();
    await expect.poll(async()=>surface.evaluate((host,geometry)=>{
      const canvas=host.querySelector('canvas')!;const rect=canvas.getBoundingClientRect(),context=canvas.getContext('2d')!;
      const zoom=Number(host.getAttribute('data-viewport-zoom')),panX=Number(host.getAttribute('data-viewport-pan-x')),panY=Number(host.getAttribute('data-viewport-pan-y'));
      const ratio=canvas.width/rect.width;
      const x=Math.max(0,Math.floor((geometry.x*zoom+panX)*ratio)),y=Math.max(0,Math.floor((geometry.y*zoom+panY)*ratio));
      const width=Math.min(canvas.width-x,Math.max(1,Math.ceil(geometry.width*zoom*ratio))),height=Math.min(canvas.height-y,Math.max(1,Math.ceil(geometry.height*zoom*ratio)));
      if(width<=0||height<=0)return 0;
      const pixels=context.getImageData(x,y,width,height).data;let ink=0;
      for(let index=0;index<pixels.length;index+=4)if(pixels[index+3]!>200 && pixels[index]!+pixels[index+1]!+pixels[index+2]!<650)ink++;
      return ink;
    },paintedNode.geometry)).toBeGreaterThan(5);
    await page.getByRole('button',{name:'更多白板操作',exact:true}).click();
    await page.getByTestId('board-diagram-source-export').click();
    await expect(page.getByTestId('board-diagram-source')).toHaveValue(`\`\`\`${source.family==='persona'?'persona':'mermaid'}\n${code}\n\`\`\``);
    evidence.push({family:source.family,boardId,artifactId:request.layout.artifactId,sourceRevision:request.layout.sourceRevision,layoutHash:request.layout.layoutHash,revision:snapshot.revision,canonicalObjects:snapshot.objects.length,source:code});
  }
  return evidence;
}
