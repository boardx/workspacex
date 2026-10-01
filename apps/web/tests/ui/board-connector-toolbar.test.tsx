import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ConnectorRelationship} from '@repo/whiteboard-core';
import {WHITEBOARD_CONNECTOR_LIMITS} from '@repo/contracts/whiteboard-document';
import {BoardConnectorToolbar} from '@/components/whiteboard/board-connector-toolbar';
afterEach(cleanup);
const relationship:ConnectorRelationship={from:'a',to:'b',fromAnchor:'right',toAnchor:'left',type:'straight',startStyle:'none',endStyle:'arrow',lineStyle:'solid',label:'before',semanticRelation:''};
const mount=(disabled=false)=>{const change=vi.fn(),color=vi.fn();render(<BoardConnectorToolbar relationship={relationship} color="#123456" disabled={disabled} onRelationshipChange={change} onColorChange={color}/>);return{change,color};};
it('shows canonical width on the line-weight trigger, not an uncommitted numeric draft',()=>{
 const props={relationship,color:'#123456',disabled:false,onRelationshipChange:vi.fn(),onColorChange:vi.fn()};const view=render(<BoardConnectorToolbar {...props}/>);
 expect(screen.getByTestId('board-connector-width-open')).toHaveTextContent('2');
 fireEvent.click(screen.getByTestId('board-connector-width-open'));fireEvent.change(screen.getByTestId('board-connector-width'),{target:{value:'8'}});
 expect(screen.getByTestId('board-connector-width-open')).toHaveTextContent('2');
 view.rerender(<BoardConnectorToolbar {...props} relationship={{...relationship,strokeWidth:7}}/>);
 expect(screen.getByTestId('board-connector-width-open')).toHaveTextContent('7');
});
it('replaces a dirty width draft with one preset command rather than blur plus click commands',()=>{
 const{change}=mount();fireEvent.click(screen.getByTestId('board-connector-width-open'));
 const input=screen.getByTestId('board-connector-width');input.focus();fireEvent.change(input,{target:{value:'8'}});
 const preset=screen.getByTestId('board-connector-width-4');
 const down=new MouseEvent('pointerdown',{button:0,bubbles:true,cancelable:true});
 if(fireEvent(preset,down))fireEvent.blur(input);
 fireEvent.click(preset);
 expect(change).toHaveBeenCalledOnce();expect(change).toHaveBeenCalledWith({strokeWidth:4});
});
it('keeps all primary icon controls in one row and width editing out of the primary row',()=>{
 mount();expect(screen.getByRole('toolbar')).toHaveClass('flex-nowrap');expect(screen.queryByTestId('board-connector-width')).toBeNull();expect(screen.getByTestId('board-connector-width-open')).toHaveAttribute('title','连接线粗细');
});
it('preserves a dirty multiline label after a remote label change and refuses silent overwrite',()=>{
 const change=vi.fn(),props={relationship,color:'#123456',disabled:false,onRelationshipChange:change,onColorChange:vi.fn()};
 const view=render(<BoardConnectorToolbar {...props}/>);fireEvent.click(screen.getByTestId('board-connector-label-open'));
 fireEvent.change(screen.getByTestId('board-connector-label'),{target:{value:'local\ndraft'}});
 view.rerender(<BoardConnectorToolbar {...props} relationship={{...relationship,label:'remote'}}/>);
 expect(screen.getByTestId('board-connector-label')).toHaveValue('local\ndraft');fireEvent.click(screen.getByTestId('board-connector-label-save'));expect(change).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeVisible();
});
it('does not reset an IME draft on composing Escape and rejects over-limit labels without truncation',()=>{
 const{change}=mount();fireEvent.click(screen.getByTestId('board-connector-label-open'));const input=screen.getByTestId('board-connector-label');
 fireEvent.change(input,{target:{value:'输入草稿'}});fireEvent.keyDown(input,{key:'Escape',isComposing:true});expect(input).toHaveValue('输入草稿');
 const tooLong='x'.repeat(1001);fireEvent.change(input,{target:{value:tooLong}});fireEvent.click(screen.getByTestId('board-connector-label-save'));expect(change).not.toHaveBeenCalled();expect(input).toHaveValue(tooLong);expect(screen.getByRole('alert')).toBeVisible();
});
it('edits independent tips and line pattern through actual previews',()=>{
 const{change}=mount();fireEvent.click(screen.getByTestId('board-connector-endpoints-open'));
 fireEvent.click(screen.getByTestId('board-connector-start-diamond'));expect(change).toHaveBeenLastCalledWith({startStyle:'diamond'});
 fireEvent.click(screen.getByTestId('board-connector-end-circle'));expect(change).toHaveBeenLastCalledWith({endStyle:'circle'});
 fireEvent.click(screen.getByTestId('board-connector-pattern-open'));fireEvent.click(screen.getByTestId('board-connector-pattern-dotted'));expect(change).toHaveBeenLastCalledWith({lineStyle:'dotted'});
 expect(screen.getByTestId('board-connector-pattern-dotted').querySelector('[data-connector-line-preview]')).toHaveStyle({borderTopStyle:'dotted'});
});
it('uses distinct horizontal line and combined endpoint icons without duplicate primary entrances',()=>{
 mount();expect(screen.queryByTestId('board-connector-start-open')).toBeNull();expect(screen.queryByTestId('board-connector-end-open')).toBeNull();
 expect(screen.getByTestId('board-connector-endpoints-open').querySelector('.lucide-arrow-left-right')).not.toBeNull();
 expect(screen.getByTestId('board-connector-pattern-open').querySelector('[data-connector-line-preview]')).toHaveStyle({borderTopStyle:'solid'});
 fireEvent.click(screen.getByTestId('board-connector-pattern-open'));
 for(const style of ['solid','dashed','dotted'])expect(screen.getByTestId(`board-connector-pattern-${style}`).querySelector('[data-connector-line-preview]')).toHaveStyle({borderTopStyle:style});
});
it('disables both endpoint groups after permission is revoked while their shared menu is open',()=>{
 const change=vi.fn(),props={relationship,color:'#123456',disabled:false,onRelationshipChange:change,onColorChange:vi.fn()};const view=render(<BoardConnectorToolbar {...props}/>);
 fireEvent.click(screen.getByTestId('board-connector-endpoints-open'));
 expect(screen.getByRole('group',{name:'连接起点'})).toBeVisible();expect(screen.getByRole('group',{name:'连接终点'})).toBeVisible();
 view.rerender(<BoardConnectorToolbar {...props} disabled/>);
 for(const end of ['start','end'])for(const tip of ['none','arrow','circle','diamond']){const button=screen.getByTestId(`board-connector-${end}-${tip}`);expect(button).toBeDisabled();fireEvent.click(button);}
 expect(change).not.toHaveBeenCalled();
});
it('commits multiline label once explicitly rather than creating history per keystroke',()=>{
 const{change,color}=mount();fireEvent.change(screen.getByTestId('board-connector-color'),{target:{value:'#abcdef'}});expect(color).toHaveBeenCalledWith('#ABCDEF');
 fireEvent.click(screen.getByTestId('board-connector-label-open'));fireEvent.change(screen.getByTestId('board-connector-label'),{target:{value:'one\ntwo'}});expect(change).not.toHaveBeenCalled();
 fireEvent.click(screen.getByTestId('board-connector-label-save'));expect(change).toHaveBeenCalledOnce();expect(change).toHaveBeenCalledWith({label:'one\ntwo'});
});
it('disables every mutating toolbar entrance',()=>{const{change,color}=mount(true);for(const button of screen.getByRole('toolbar').querySelectorAll('button'))expect(button).toBeDisabled();expect(screen.getByTestId('board-connector-color')).toBeDisabled();expect(change).not.toHaveBeenCalled();expect(color).not.toHaveBeenCalled();});
it('commits width on blur once and rejects invalid draft values without a command',()=>{
 const{change}=mount();fireEvent.click(screen.getByTestId('board-connector-width-open'));const input=screen.getByTestId('board-connector-width');
 fireEvent.change(input,{target:{value:'8'}});expect(change).not.toHaveBeenCalled();fireEvent.blur(input);expect(change).toHaveBeenCalledWith({strokeWidth:8});
 change.mockClear();fireEvent.change(input,{target:{value:'999'}});fireEvent.blur(input);expect(change).not.toHaveBeenCalled();expect(input).toHaveValue(2);
 fireEvent.change(input,{target:{value:''}});fireEvent.blur(input);expect(change).not.toHaveBeenCalled();
});
it('clears old controls when path kind changes and explicitly centers a label on arc length',()=>{
 const{change}=mount();fireEvent.click(screen.getByTestId('board-connector-path-open'));fireEvent.click(screen.getByTestId('board-connector-curve'));expect(change).toHaveBeenCalledWith({type:'curve',route:undefined});
 fireEvent.click(screen.getByTestId('board-connector-label-open'));fireEvent.click(screen.getByTestId('board-connector-label-center'));expect(change).toHaveBeenLastCalledWith({labelPosition:{t:.5,normalOffset:0}});
});
it('drops uncommitted drafts after permission becomes readonly without emitting mutations',()=>{
 const change=vi.fn(),props={relationship,color:'#123456',disabled:false,onRelationshipChange:change,onColorChange:vi.fn()};
 const view=render(<BoardConnectorToolbar {...props}/>);
 fireEvent.click(screen.getByTestId('board-connector-width-open'));
 fireEvent.change(screen.getByTestId('board-connector-width'),{target:{value:'8'}});
 fireEvent.click(screen.getByTestId('board-connector-label-open'));fireEvent.change(screen.getByTestId('board-connector-label'),{target:{value:'draft'}});
 view.rerender(<BoardConnectorToolbar {...props} disabled/>);
 fireEvent.click(screen.getByTestId('board-connector-label-save'));
 expect(screen.getByTestId('board-connector-label')).toBeDisabled();expect(screen.getByTestId('board-connector-width-open')).toBeDisabled();expect(change).not.toHaveBeenCalled();
});
it.each([WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMin,WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMax])('accepts canonical width boundary %s exactly once',value=>{
 const{change}=mount();fireEvent.click(screen.getByTestId('board-connector-width-open'));const input=screen.getByTestId('board-connector-width');fireEvent.change(input,{target:{value:String(value)}});fireEvent.blur(input);expect(change).toHaveBeenCalledOnce();expect(change).toHaveBeenCalledWith({strokeWidth:value});
});
it('emits a single type-and-route patch without rewriting endpoints, width or label position',()=>{
 const change=vi.fn(),custom:ConnectorRelationship={...relationship,type:'curve',strokeWidth:8,route:{kind:'curve',startOffset:{x:30,y:40},endOffset:{x:-30,y:-40}},labelPosition:{t:.3,normalOffset:12}};
 render(<BoardConnectorToolbar relationship={custom} color="#123456" disabled={false} onRelationshipChange={change} onColorChange={vi.fn()}/>);
 fireEvent.click(screen.getByTestId('board-connector-path-open'));fireEvent.click(screen.getByTestId('board-connector-elbow'));
 expect(change).toHaveBeenCalledOnce();expect(change).toHaveBeenCalledWith({type:'elbow',route:undefined});
 expect(custom.route).toEqual({kind:'curve',startOffset:{x:30,y:40},endOffset:{x:-30,y:-40}});
});
