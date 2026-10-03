import assert from 'node:assert/strict';
const canonical=state=>({epoch:state.head.epoch,seq:state.head.seq,objects:state.objects});
export async function runStickyPickerMemory(ctx){
 const receipts=[];
 for(const color of Object.keys(ctx.colors))for(const variant of ['square','rectangle','circle']){
  const before=await ctx.state();await ctx.choose(variant,color);
  assert.equal(await ctx.page.getByTestId(`board-sticky-default-${color}`).getAttribute('aria-pressed'),'true');
  assert.equal(await ctx.page.getByTestId(`board-sticky-${variant}`).getAttribute('aria-pressed'),'true');
  const picker=await ctx.samplePickerPixels(ctx.owner,variant,color),dock=await ctx.sampleDockPixels(ctx.owner,variant,color);
  assert.deepEqual(canonical(await ctx.state()),canonical(before));
  await ctx.page.keyboard.press('Escape');await ctx.page.getByTestId('board-add-sticky').click();
  assert.equal(await ctx.page.getByTestId(`board-sticky-default-${color}`).getAttribute('aria-pressed'),'true');
  assert.equal(await ctx.page.getByTestId(`board-sticky-${variant}`).getAttribute('aria-pressed'),'true');
  assert.deepEqual(canonical(await ctx.state()),canonical(before));await ctx.shot(`S01-${color}-${variant}`);
  await ctx.page.keyboard.press('Escape');receipts.push({color,variant,picker,dock});
 }
 return{case:'S01',receipts};
}
export async function runStickySingleShot(ctx){
 const receipts=[];
 for(const color of Object.keys(ctx.colors))for(const variant of ['square','rectangle','circle']){
  const before=await ctx.state(),point=await ctx.blank(),id=await ctx.createStickyNative(variant,color,point),after=await ctx.state();
  const note=after.objects.find(item=>item.id===id);assert(note);assert.equal(note.extensionData.thinkingInput.sticky.variant,variant);assert.equal(note.extensionData.thinkingInput.sticky.color.toUpperCase(),ctx.colors[color].toUpperCase());
  assert.equal(after.head.seq,before.head.seq+1);assert.equal(after.objects.length,before.objects.length+1);
  assert.equal(await ctx.page.getByTestId('board-tool-select').getAttribute('aria-pressed'),'true');
  await ctx.assertBlankRenderedNote(ctx.owner,id);await ctx.shot(`S02-${color}-${variant}-created`);
  const blank=await ctx.blank();await ctx.page.mouse.click(blank.x,blank.y);assert.deepEqual(canonical(await ctx.state()),canonical(after));
  const selectedColor=await ctx.sampleSelectedStickyColor(ctx.owner,id,color);await ctx.shot(`S02-${color}-${variant}-selected-toolbar`);
  await ctx.deleteStickyNative(ctx.owner,id);receipts.push({color,variant,id,seq:after.head.seq,selectedColor});
 }
 return{case:'S02',receipts};
}
