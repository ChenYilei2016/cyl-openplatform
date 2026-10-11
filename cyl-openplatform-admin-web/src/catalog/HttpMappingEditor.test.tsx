import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { BindingEditor, HttpRequestPreview, MappingEditor, type Binding } from './BindingEditor';
import { switchHttpMethodMappings } from './httpMapping';
import type { AdminApi } from '../access/api';
import type { Mapping } from './SchemaEditor';
import { stringifyJson } from '@cyl/open-platform-web-shared/json';

const original: Mapping[] = [{ target: 'id', source: 'REQUEST', path: 'id', location: 'PATH' }, { target: 'id', source: 'REQUEST', path: 'id' }];
const schema = { type: 'OBJECT' as const, properties: { id: { type: 'STRING' as const } }, example: { id: '中文 +%' } };
afterEach(cleanup);
test('位置编辑保留切换前正文，自动路径行去重，改名保留旧规则，预览不调用服务', async () => {
  const api = vi.fn();
  function Editor() {
    const [binding, setBinding] = useState<Binding>({ protocol: 'HTTP', timeoutMillis: 3000, http: { url: 'https://internal.example/orders/{id}/{id}', method: 'POST' } });
    const [mappings, setMappings] = useState(original);
    const changeBinding = (value: Binding) => { setMappings(current => switchHttpMethodMappings(current, binding.http!.method, value.http!.method, original, 'POST')); setBinding(value); };
    return <><BindingEditor api={api} value={binding} onChange={changeBinding} onRequestChange={changeBinding} mappingCount={mappings.length} />
      <HttpRequestPreview binding={binding} mappings={mappings} requestSchema={schema} />
      <MappingEditor api={api} binding={binding} mappings={mappings} onChange={setMappings} paths={['id']} requestSchema={schema} />
      <output aria-label="当前规则">{stringifyJson(mappings)}</output></>;
  }
  render(<Editor />);
  expect(within(screen.getByRole('region', { name: 'PATH映射' })).getAllByRole('textbox')).toHaveLength(1);
  expect(screen.getByRole('region', { name: '最终HTTP请求预览' }).textContent).toContain('%E4%B8%AD%E6%96%87%20%2B%25');
  fireEvent.mouseDown(screen.getByLabelText('HTTP 方法'));
  fireEvent.click(await screen.findByText('GET', { selector: '.ant-select-item-option-content' }));
  expect(screen.getByRole('region', { name: 'BODY映射' }).querySelector('fieldset')?.disabled).toBe(true);
  expect(screen.getByLabelText('当前规则').textContent).toContain('"location":"BODY"');
  fireEvent.mouseDown(screen.getByLabelText('HTTP 方法'));
  fireEvent.click(await screen.findByText('POST', { selector: '.ant-select-item-option-content' }));
  expect(screen.getByLabelText('当前规则').textContent).toBe(stringifyJson(original));
  fireEvent.change(screen.getByLabelText('内部请求地址'), { target: { value: 'https://internal.example/orders/{next}' } });
  expect(screen.getByLabelText('路径变量next目标').getAttribute('readonly')).not.toBeNull();
  expect(screen.getByText(/已移除路径变量/)).toBeTruthy();
  fireEvent.mouseDown(screen.getByLabelText('路径变量next字段'));
  fireEvent.click(await screen.findByText('id', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: /清理.*旧PATH/ }));
  expect(screen.getByLabelText('当前规则').textContent).not.toContain('"target":"id","source":"REQUEST","path":"id","location":"PATH"');
  expect(screen.getByRole('region', { name: '最终HTTP请求预览' }).textContent).toContain('orders/%E4%B8%AD%E6%96%87%20%2B%25');
  expect(api).not.toHaveBeenCalled();
});

 test('清理旧PATH保留其他行的未应用固定值和校验状态', () => {
  const api=vi.fn();
  function Editor() {
    const [mappings,setMappings]=useState<Mapping[]>(['old','b','c'].map(target=>({target,source:'FIXED',value:null,location:'PATH'})));
    return <MappingEditor api={api} binding={{protocol:'HTTP',timeoutMillis:3000,http:{url:'https://internal.example/{b}/{c}',method:'GET'}}} mappings={mappings} onChange={setMappings} paths={[]} />;
  }
  render(<Editor />);
  const inputs=screen.getAllByLabelText('固定 JSON 值');
  fireEvent.change(inputs[0],{target:{value:'{"b":2}'}});
  fireEvent.change(inputs[1],{target:{value:'{"c":3}'}});
  fireEvent.click(screen.getByRole('button',{name:'清理1条旧PATH规则'}));
  const remaining=screen.getAllByLabelText('固定 JSON 值') as HTMLInputElement[];
  expect(remaining.map(input=>input.value)).toEqual(['{"b":2}','{"c":3}']);
  expect(remaining.every(input=>input.validity.customError)).toBe(true);
  expect(api).not.toHaveBeenCalled();
 });

test('两行固定值校验乱序返回仍保留各自新值', async () => {
  const completions: Record<string, (value: unknown) => void> = {};
  const api: AdminApi = <T,>(_path: string, options?: Parameters<AdminApi>[1]) => new Promise<T>(resolve => { completions[String(options?.bodyText)] = value => resolve(value as T); });
  function Editor() {
    const [mappings,setMappings]=useState<Mapping[]>([
      {target:'id',source:'FIXED',value:'old-path',location:'PATH'},
      {target:'q',source:'FIXED',value:'old-query',location:'QUERY'},
    ]);
    return <><MappingEditor api={api} binding={{protocol:'HTTP',timeoutMillis:3000,http:{url:'https://internal.example/{id}',method:'GET'}}} mappings={mappings} onChange={setMappings} paths={[]} />
      <output aria-label="最新映射">{stringifyJson(mappings)}</output></>;
  }
  render(<Editor />);
  const inputs=screen.getAllByLabelText('固定 JSON 值');
  fireEvent.change(inputs[0],{target:{value:'"new-path"'}});
  fireEvent.change(inputs[1],{target:{value:'"new-query"'}});
  fireEvent.click(within(inputs[0].closest('tr')!).getByRole('button',{name:'校验并应用'}));
  fireEvent.click(within(inputs[1].closest('tr')!).getByRole('button',{name:'校验并应用'}));
  await act(async () => completions['"new-query"']('new-query'));
  await act(async () => completions['"new-path"']('new-path'));
  expect(screen.getByLabelText('最新映射').textContent).toContain('"value":"new-path"');
  expect(screen.getByLabelText('最新映射').textContent).toContain('"value":"new-query"');
});

test('服务名和URL显式切换保留输入，可选契约不参与预览，实例只在明确检查后查询', async () => {
  const api = vi.fn(async () => ({serviceName:'orders',instanceCount:2,checkedAt:'2026-09-30T10:00:00Z'})) as unknown as AdminApi;
  function Host() {
    const [binding,setBinding]=useState<Binding>({protocol:'HTTP',timeoutMillis:3000,http:{url:'https://fixed.example/orders',method:'POST'}});
    return <><BindingEditor api={api} value={binding} onChange={setBinding} onRequestChange={setBinding} mappingCount={0}/>
      <HttpRequestPreview binding={binding} mappings={[]} requestSchema={schema}/></>;
  }
  render(<Host/>);
  fireEvent.click(screen.getByRole('radio',{name:'服务名发现'}));
  fireEvent.change(screen.getByLabelText('内部服务名'),{target:{value:'orders'}});
  fireEvent.change(screen.getByLabelText('内部请求路径'),{target:{value:'/lookup'}});
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByText('尚未查询当前环境实例')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'检查实例'}));
  expect(await screen.findByText(/当前环境可用 2 个实例/)).toBeTruthy();
  fireEvent.click(screen.getByText(/契约来源（可选）/));
  fireEvent.change(screen.getByLabelText('内部接口类'),{target:{value:'com.example.OrderFeignClient'}});
  fireEvent.change(screen.getByLabelText('内部Java方法'),{target:{value:'lookup'}});
  expect(screen.getByRole('region',{name:'最终HTTP请求预览'}).textContent).toContain('[orders → 当前环境实例]/lookup');
  fireEvent.click(screen.getByRole('radio',{name:'固定 URL'}));
  expect(screen.getByLabelText('内部请求地址')).toHaveProperty('value','https://fixed.example/orders');
  fireEvent.click(screen.getByRole('radio',{name:'服务名发现'}));
  expect(screen.getByLabelText('内部请求路径')).toHaveProperty('value','/lookup');
  fireEvent.change(screen.getByLabelText('内部服务名'),{target:{value:'another'}});
  expect(screen.getByText('尚未查询当前环境实例')).toBeTruthy();
  expect(api).toHaveBeenCalledTimes(1);
});
