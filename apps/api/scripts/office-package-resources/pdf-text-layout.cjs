'use strict';
/** Shared with the mounted PDF Skill. Widths are measured by the actual embedded font. */
function wrapTextByWidth(text, font, size, maxWidth) {
  if (!(size > 0 && maxWidth > 0)) throw new Error('Invalid text bounds');
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/u)) {
    let line = '';
    for (const character of paragraph) {
      if (font.widthOfTextAtSize(character, size) > maxWidth) throw new Error('Glyph exceeds line width');
      if (line && font.widthOfTextAtSize(line + character, size) > maxWidth) {
        lines.push(line); line = character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}
function drawWrappedText(page, text, options) {
  const {font,size=12,x=50,rightMargin=50,topMargin=50,bottomMargin=50,lineHeight=size*1.3,...rest}=options;
  let {y=page.getHeight()-topMargin}=rest;
  const lines=wrapTextByWidth(text,font,size,page.getWidth()-x-rightMargin);
  const {y:ignored,...style}=rest;
  for(const line of lines){
    if(y-size<bottomMargin){page=page.doc.addPage([page.getWidth(),page.getHeight()]);y=page.getHeight()-topMargin;}
    page.drawText(line,{...style,x,y,font,size});y-=lineHeight;
  }
  return {page,y,lines};
}
module.exports={wrapTextByWidth,drawWrappedText};
