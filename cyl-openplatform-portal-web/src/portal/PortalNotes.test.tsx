import { cleanup, fireEvent, render as renderRaw, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ApiClient } from '@cyl/open-platform-web-shared/http';
import { PlatformTheme } from '@cyl/open-platform-web-shared/ui/PlatformTheme';
import PortalApplications from './PortalApplications';
import { PortalMutationError, type PortalApplication, type PortalSession } from './api';

const session: PortalSession = { tenantId: 'notes-tenant', employeeNo: 'employee', userId: 'user', displayName: '员工' };
const application: PortalApplication = { scopes: [],
  id: 'grant-notes', applicationId: 'app-notes', appKey: 'a'.repeat(32),
  name: '仓储旧备注', globalName: '仓储凭据', applicationStatus: 'ENABLED', status: 'ACTIVE',
  authorizationVersion: 3, note: '仓储旧备注', noteRevision: 4,
};
const bindingPath = `/bindings/${application.id}`;
const api = vi.fn<ApiClient>();
const render = (node: ReactElement) => renderRaw(node, { wrapper: ({ children }) => <PlatformTheme variant="portal">{children}</PlatformTheme> });

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  history.replaceState(null, '', '/portal/?section=settings');
  sessionStorage.clear();
  api.mockReset().mockImplementation(async path => (path === '/applications/grant-notes' ? application : {items:[application],total:1,page:1,pageSize:20}) as never);
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openNote() {
  render(<PortalApplications session={session} api={api as ApiClient} />);
  fireEvent.click(await screen.findByRole('button',{name:'查看 仓储旧备注 详情'}));
  await screen.findByRole('region',{name:'凭据概览'});
  await waitFor(() => expect((screen.getByRole('button',{name:'刷新关联状态'}) as HTMLButtonElement).disabled).toBe(false));
  const opener = await screen.findByRole('button', { name: '编辑备注' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: '编辑本租户备注' });
  const input = within(dialog).getByRole('textbox', { name: '本租户备注' }) as HTMLInputElement;
  return { opener, dialog, input };
}

test.each(['Escape', '取消'])('备注通过原生模态打开，%s取消保留原记录并恢复入口焦点，不发送写请求', async action => {
  const { opener, dialog, input } = await openNote();
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  expect((dialog as HTMLDialogElement).open).toBe(true);
  expect(input.value).toBe(application.note);
  fireEvent.change(input, { target: { value: '尚未保存的备注' } });
  if (action === 'Escape') {
    // jsdom 不执行 Escape 的浏览器默认行为，触发该行为对应的原生 cancel 事件。
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
  } else {
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  }
  expect(screen.queryByRole('dialog', { name: '编辑本租户备注' })).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(api.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  fireEvent.click(opener);
  expect((screen.getByRole('textbox', { name: '本租户备注' }) as HTMLInputElement).value).toBe(application.note);
});

test('备注按Unicode字符计数，100个补充字符可保存、101个禁用，空白显式清除', async () => {
  const { dialog, input } = await openNote();
  const save = within(dialog).getByRole('button', { name: '保存备注' }) as HTMLButtonElement;
  fireEvent.change(input, { target: { value: '😀'.repeat(100) } });
  expect(within(dialog).getByText('100 / 100 字')).toBeTruthy();
  expect(save.disabled).toBe(false);
  fireEvent.change(input, { target: { value: '😀'.repeat(101) } });
  expect(within(dialog).getByText('101 / 100 字')).toBeTruthy();
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  expect(api.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
  fireEvent.change(input, { target: { value: '   ' } });
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await screen.findByText('本租户备注已保存，不影响其他租户或已有 Token。');
  expect(api).toHaveBeenCalledWith(`${bindingPath}/note`, expect.objectContaining({
    method: 'PUT', body: { note: '', expectedRevision: 4 },
  }));
  expect(screen.queryByRole('dialog', { name: '编辑本租户备注' })).toBeNull();
});

test.each([
  ['409冲突', new PortalMutationError('备注已被同事修改', 'REJECTED', 40900001)],
  ['未知结果', new PortalMutationError('未收到明确的操作结果', 'UNKNOWN')],
] as const)('%s保留输入并阻止盲目重试，核对最新版本后只能显式保存', async (_kind, failure) => {
  const { dialog, input } = await openNote();
  const draft = '我的新备注';
  fireEvent.change(input, { target: { value: draft } });
  api.mockRejectedValueOnce(failure);
  fireEvent.click(within(dialog).getByRole('button', { name: '保存备注' }));
  await within(dialog).findByText(failure.message);
  expect(input.value).toBe(draft);
  const save = within(dialog).getByRole('button', { name: '保存备注' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  expect(api.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
  expect(api.mock.calls.filter(([path]) => path === bindingPath)).toHaveLength(0);

  api.mockResolvedValueOnce({ note: '同事的新备注', noteRevision: 7, status: 'ACTIVE' });
  fireEvent.click(within(dialog).getByRole('button', { name: '核对最新备注，保留输入' }));
  await within(dialog).findByText('服务器最新备注：同事的新备注。你的输入已保留，请核对后保存。');
  expect(api).toHaveBeenCalledWith(bindingPath, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(input.value).toBe(draft);
  expect(api.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: '按核对结果保存备注' }));
  await screen.findByText('本租户备注已保存，不影响其他租户或已有 Token。');
  const writes = api.mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(writes).toHaveLength(2);
  expect(writes.map(([path, options]) => [path, options?.body])).toEqual([
    [`${bindingPath}/note`, { note: draft, expectedRevision: 4 }],
    [`${bindingPath}/note`, { note: draft, expectedRevision: 7 }],
  ]);
});

test('核对发现已解绑时备注只读，输入保留且不能继续写入', async () => {
  const { dialog, input } = await openNote();
  fireEvent.change(input, { target: { value: '待保存备注' } });
  api.mockRejectedValueOnce(new PortalMutationError('关联状态已变化', 'REJECTED', 40900001));
  fireEvent.click(within(dialog).getByRole('button', { name: '保存备注' }));
  await within(dialog).findByText('关联状态已变化');
  api.mockResolvedValueOnce({ note: application.note, noteRevision: 5, status: 'REVOKED' });
  fireEvent.click(within(dialog).getByRole('button', { name: '核对最新备注，保留输入' }));
  await within(dialog).findByText('此租户关联已解绑，备注只读。');
  expect(input.value).toBe('待保存备注');
  expect(input.disabled).toBe(true);
  const save = within(dialog).getByRole('button', { name: '按核对结果保存备注' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  await waitFor(() => expect(api.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1));
});
