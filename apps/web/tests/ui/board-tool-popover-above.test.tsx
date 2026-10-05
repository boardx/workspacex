import {renderToString} from 'react-dom/server';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BoardToolPopover} from '@/components/whiteboard/board-tool-popover';

afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('flips below a header-adjacent trigger when above has no space',()=>{
 render(<BoardToolPopover label="连接标签" placement="above" trigger={<button data-testid="trigger">Open</button>}>Content</BoardToolPopover>);
 vi.spyOn(screen.getByTestId('trigger'),'getBoundingClientRect').mockReturnValue({left:100,top:80,bottom:124,right:144,x:100,y:80,width:44,height:44,toJSON:()=>({})});
 fireEvent.click(screen.getByTestId('trigger'));
 const dialog=screen.getByRole('dialog',{hidden:true});
 expect(dialog).toHaveAttribute('data-board-popover-placement','below');
 expect(dialog).toHaveStyle({top:'132px'});
 expect(dialog).not.toHaveStyle({visibility:'hidden'});
});

it('keeps decorative padding inside the height-constrained scrolling frame',()=>{
 render(<BoardToolPopover label="连接标签" placement="above" trigger={<button data-testid="trigger">Open</button>}>Content</BoardToolPopover>);
 vi.spyOn(screen.getByTestId('trigger'),'getBoundingClientRect').mockReturnValue({left:100,top:90,bottom:134,right:144,x:100,y:90,width:44,height:44,toJSON:()=>({})});
 fireEvent.click(screen.getByTestId('trigger'));
 const dialog=screen.getByRole('dialog');
 expect(dialog.classList.contains('p-4')).toBe(false);
 expect(dialog.firstElementChild).toHaveClass('p-4');
 expect(dialog).toHaveStyle({top:'142px'});
});

it.each(['便利贴样式','文字样式','外观','布局','标签与链接','更多操作','连接线路径','连接线粗细','连接线型','连接端点','连接标签'])('keeps shared %s above a restricted desktop trigger',label=>{
 render(<BoardToolPopover label={label} placement="above" trigger={<button data-testid="trigger">Open</button>}><button>Action</button></BoardToolPopover>);
 vi.spyOn(screen.getByTestId('trigger'),'getBoundingClientRect').mockReturnValue({left:396,top:220.5,bottom:264.5,right:440,x:396,y:220.5,width:44,height:44,toJSON:()=>({})});
 fireEvent.click(screen.getByTestId('trigger'));
 const dialog=screen.getByRole('dialog');
 expect(dialog).toHaveAttribute('data-board-popover-placement','above');
 expect(dialog).toHaveStyle({left:'396px',top:'212.5px',maxHeight:'140.5px',transform:'translateY(-100%)'});
 expect(dialog.className).toContain('overflow-y-auto');
 fireEvent.click(screen.getByRole('button',{name:`关闭${label}`}));
 expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps an above submenu within a 390px viewport as its trigger moves',()=>{
 vi.stubGlobal('innerWidth',390);
 render(<BoardToolPopover label="连接标签" placement="above" trigger={<button data-testid="trigger">Open</button>}>Content</BoardToolPopover>);
 let top=220.5;
 vi.spyOn(screen.getByTestId('trigger'),'getBoundingClientRect').mockImplementation(()=>({left:340,top,bottom:top+44,right:384,x:340,y:top,width:44,height:44,toJSON:()=>({})}));
 fireEvent.click(screen.getByTestId('trigger'));
 expect(screen.getByRole('dialog')).toHaveStyle({left:'54px',top:'212.5px',maxHeight:'140.5px'});
 top=500;fireEvent(window,new Event('resize'));
 expect(screen.getByRole('dialog')).toHaveStyle({left:'54px',top:'492px',maxHeight:'420px'});
 vi.unstubAllGlobals();
});

 it.each([{left:100,right:144,side:'right',expectedLeft:152},{left:900,right:944,side:'left',expectedLeft:572}])('places default inspectors beside the parent and flips at the edge ($side)',({left,right,side,expectedLeft})=>{
 vi.stubGlobal('innerWidth',1024);
 render(<BoardToolPopover label="便利贴样式" trigger={<button data-testid="trigger">Open</button>}>Content</BoardToolPopover>);
 vi.spyOn(screen.getByTestId('trigger'),'getBoundingClientRect').mockReturnValue({left,top:200,bottom:244,right,x:left,y:200,width:44,height:44,toJSON:()=>({})});
 fireEvent.click(screen.getByTestId('trigger'));
 expect(screen.getByRole('dialog')).toHaveAttribute('data-board-popover-placement',side);
 expect(screen.getByRole('dialog')).toHaveStyle({left:`${expectedLeft}px`,top:'200px'});
 vi.unstubAllGlobals();
 });

it('renders compact connector menus without browser globals during SSR',()=>{
 vi.stubGlobal('window',undefined);
 try{expect(()=>renderToString(<BoardToolPopover label="连接线路径" compact trigger={<button>连接线路径</button>}>路径</BoardToolPopover>)).not.toThrow();}finally{vi.unstubAllGlobals();}
});

it('includes border thickness when clamping a low side submenu inside the viewport',()=>{
 vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',1000);
 const offset=vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(122);
 const client=vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(120);
 const scroll=vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockReturnValue(120);
 render(<BoardToolPopover label="外观" trigger={<button data-testid="trigger">Open</button>}>Content</BoardToolPopover>);
 vi.spyOn(screen.getByTestId('trigger'),'getBoundingClientRect').mockReturnValue({left:400,right:444,top:960,bottom:1004,width:44,height:44,x:400,y:960,toJSON:()=>({})});
 fireEvent.click(screen.getByTestId('trigger'));fireEvent(window,new Event('resize'));
 expect(screen.getByRole('dialog')).toHaveStyle({top:'862px'});
 expect(862+122).toBe(1000-16);
 offset.mockRestore();client.mockRestore();scroll.mockRestore();vi.unstubAllGlobals();
});
