import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {ErrorFeedback,LoadFeedback} from '@cyl/open-platform-web-shared/components';
import {PlatformTheme} from '@cyl/open-platform-web-shared/ui/PlatformTheme';
afterEach(cleanup);
test('错误可关闭；新错误和下一次操作的同文错误重新显示',async()=>{
 const view=render(<ErrorFeedback error="状态已变化"/>,{wrapper:PlatformTheme});
 fireEvent.click(screen.getByRole('button',{name:'关闭错误提示'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 view.rerender(<ErrorFeedback error="网络异常"/>);expect(screen.getByRole('alert').textContent).toContain('网络异常');
 fireEvent.click(screen.getByRole('button',{name:'关闭错误提示'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 view.rerender(<ErrorFeedback error=""/>);view.rerender(<ErrorFeedback error="网络异常"/>);expect(screen.getByRole('alert').textContent).toContain('网络异常');
});
test('关闭读取错误保留重新加载入口，重试期间清理旧提示、再次失败重新显示',async()=>{
 const retry=vi.fn();const view=render(<LoadFeedback loading={false} error="读取失败" retry={retry}/>,{wrapper:PlatformTheme});
 fireEvent.click(screen.getByRole('button',{name:'关闭错误提示'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'重新加载'}));expect(retry).toHaveBeenCalledOnce();
 view.rerender(<LoadFeedback loading error="读取失败" retry={retry}/>);expect(screen.queryByRole('alert')).toBeNull();
 view.rerender(<LoadFeedback loading={false} error="读取失败" retry={retry}/>);expect(screen.getByRole('alert').textContent).toContain('读取失败');
});
