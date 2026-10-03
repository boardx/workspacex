import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function runStickyRotatedGlyphAndLegacy(ctx){
 const circleId=await ctx.createStickyNative('circle','pink'),text='中文与Latin 长文本换行边界\n'.repeat(180);
 await ctx.editNative(ctx.owner,circleId,text,'command');await ctx.rotateNative(ctx.owner,circleId,-30);
 const saved=await ctx.state(),staticRaster=await ctx.assertRotatedCircleGlyphs(ctx.owner,circleId,'canvas-static');await ctx.shot('S08-circle-rotated-static-glyphs');
 await ctx.activateEditorNative(ctx.owner,circleId);const input=ctx.page.getByTestId('board-thinking-editor');assert.equal(await input.inputValue(),text);
 const editorRaster=await ctx.assertRotatedCircleGlyphs(ctx.owner,circleId,'composited-editor');await ctx.shot('S08-circle-rotated-editor-glyphs');await ctx.leaveEditor();assert.deepEqual(await ctx.state(),saved);
 // Legacy API fixture is explicitly not evidence of user creation.
 const id=randomUUID(),point=await ctx.blank(),v=await ctx.view(),geometry={x:(point.x-v.x-v.panX)/v.zoom-100,y:(point.y-v.y-v.panY)/v.zoom-80,width:200,height:160,rotation:0};
 const legacy={id,schemaVersion:1,kind:'sticky',geometry,text:'Legacy font stays canonical / 中文',style:{fill:ctx.colors.blue,fontSize:32},parentId:null,orderKey:`legacy-${id}`};
 await ctx.fixtureOperation(ctx.owner,[{type:'create',object:legacy}]);const beforeLegacy=await ctx.state(),original=beforeLegacy.objects.find(object=>object.id===id);assert(original);assert(!original.extensionData?.thinkingInput);
 const swatch=await ctx.sampleSelectedStickyColor(ctx.owner,id,'blue');await ctx.activateEditorNative(ctx.owner,id);assert.equal(await input.inputValue(),legacy.text);await ctx.shot('S08-legacy-font-editor');await ctx.leaveEditor();assert.deepEqual(await ctx.state(),beforeLegacy);
 await ctx.reloadActor(ctx.owner);assert.deepEqual(await ctx.state(),beforeLegacy);assert.equal((await ctx.state()).objects.find(object=>object.id===id).style.fontSize,32);
 return{coverage:['rotated-circle lower-canvas glyph ROI','legacy compatibility fixtures'],receipts:[{circleId,staticRaster,editorRaster},{legacyId:id,legacySwatch:swatch}]};
}
