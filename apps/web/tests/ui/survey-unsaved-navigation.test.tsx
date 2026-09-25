import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useSurveyUnsavedNavigation } from '@/lib/survey/use-unsaved-navigation';

let navigation: EventTarget;
function Form({dirty=true}:{dirty?:boolean}) {
  useSurveyUnsavedNavigation(dirty);
  const [value,setValue]=React.useState('未保存的题目');
  return <><input aria-label="题目" value={value} onChange={e=>setValue(e.target.value)}/><a href="/studio/survey?tab=reports">报告模板</a><a href="#chapter">本章</a><a href="/studio/survey?tab=reports" target="_blank">新窗口</a></>;
}
function traverse(type='traverse',cancelable=true) {
  const event=new Event('navigate',{cancelable});
  Object.defineProperty(event,'navigationType',{value:type});
  navigation.dispatchEvent(event);
  return event;
}
beforeEach(()=>{
  navigation=new EventTarget();
  Object.defineProperty(window,'navigation',{configurable:true,value:navigation});
  vi.spyOn(window,'confirm').mockReturnValue(false);
});
afterEach(()=>{vi.restoreAllMocks();delete (window as unknown as {navigation?:unknown}).navigation;});
describe('survey unsaved navigation',()=>{
  it('cancels sidebar navigation and preserves entered state',()=>{
    render(<Form/>);fireEvent.change(screen.getByLabelText('题目'),{target:{value:'尚未保存'}});
    const event=new MouseEvent('click',{bubbles:true,cancelable:true,button:0});
    screen.getByText('报告模板').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);expect(window.confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('题目')).toHaveValue('尚未保存');
  });
  it('cancels both Back and Forward before the router can commit without rewriting history',()=>{
    render(<Form/>);const push=vi.spyOn(history,'pushState'),replace=vi.spyOn(history,'replaceState');
    // Both Back and Forward surface as traverse; cancellation happens before popstate.
    expect(traverse().defaultPrevented).toBe(true);expect(traverse().defaultPrevented).toBe(true);
    expect(screen.getByLabelText('题目')).toHaveValue('未保存的题目');
    expect(push).not.toHaveBeenCalled();expect(replace).not.toHaveBeenCalled();
  });
  it('allows an accepted traversal and does not prompt again at unload',()=>{
    vi.mocked(window.confirm).mockReturnValue(true);render(<Form/>);
    expect(traverse().defaultPrevented).toBe(false);
    const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);expect(window.confirm).toHaveBeenCalledOnce();
  });
  it('does not double-prompt accepted links, same-page anchors or new windows',()=>{
    vi.mocked(window.confirm).mockReturnValue(true);render(<Form/>);
    const click=new MouseEvent('click',{bubbles:true,cancelable:true,button:0});
    // Suppress jsdom default navigation after the capture guard accepts it.
    screen.getByText('报告模板').addEventListener('click',e=>e.preventDefault(),{once:true});
    screen.getByText('报告模板').dispatchEvent(click);
    traverse('push');fireEvent.click(screen.getByText('本章'));fireEvent.click(screen.getByText('新窗口'));
    expect(window.confirm).toHaveBeenCalledOnce();
  });
  it('uses native unload protection when traversal cannot be cancelled and cleans listeners when saved',()=>{
    const {rerender}=render(<Form/>);
    traverse('traverse',false);expect(window.confirm).not.toHaveBeenCalled();
    const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
    rerender(<Form dirty={false}/>);expect(traverse().defaultPrevented).toBe(false);expect(window.confirm).not.toHaveBeenCalled();
  });
});
