import {useState} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {AdminApiError,type AdminApi} from '../access/api';
import {OwnerPicker} from './CatalogReferenceFields';
import CategoryManagement from './CategoryManagement';
const first={id:'EMP_00000000000000000000000000000001',tenantId:'101',employeeId:'1',employeeNo:'E1001',displayName:'当前维护人',lastSeenAt:'2026-09-27T00:00:00Z'};
const second={...first,id:'EMP_00000000000000000000000000000002',employeeId:'2',employeeNo:'E1002',displayName:'订单负责人'};
afterEach(()=>{cleanup();vi.restoreAllMocks()});
test('人员选择查询不冒泡提交API，核验后填稳定ID而不是显示姓名',async()=>{
 const save=vi.fn(),change=vi.fn();
 const api=vi.fn(async(path:string)=>path==='/apis/owners/verify'?second:path.includes('/owners?')?{items:[second],total:1,page:1,pageSize:20}:first);
 function Harness(){const[value,setValue]=useState(first.id);return <form onSubmit={event=>{event.preventDefault();save()}}><OwnerPicker api={api as AdminApi} value={value} onChange={id=>{setValue(id);change(id)}}/></form>}
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'搜索人员'}));
 fireEvent.change(await screen.findByLabelText('姓名（包含）'),{target:{value:'订单'}});
 fireEvent.click(screen.getByRole('button',{name:'查询人员'}));
 fireEvent.click(await screen.findByRole('button',{name:'选择 订单负责人 · E1002'}));
 await waitFor(()=>expect(change).toHaveBeenCalledWith(second.id));expect(save).not.toHaveBeenCalled();
 expect(api.mock.calls.some(([path])=>path.includes('name='))).toBe(true);
});
test('删除时新出现的历史引用通过显式核对更新，保留编辑并前置要求迁移目标',async()=>{
 const source={id:'CAT_a',name:'订单',revision:1,enabled:true,draftApis:0,publishedApis:0,historicalApis:0};
 const target={...source,id:'CAT_b',name:'交易'};
 const api=vi.fn(async(path:string)=>{if(path.endsWith('/remove'))throw new Error('分类仍被历史引用');if(path==='/api-categories/CAT_a')return {...source,historicalApis:1};return {items:[source,target],total:2,page:1,pageSize:20}});
 render(<CategoryManagement api={api as AdminApi} onClose={vi.fn()} onChanged={vi.fn()}/>);
 fireEvent.click((await screen.findAllByRole('button',{name:'合并 / 删除'}))[0]);
 fireEvent.click(screen.getByRole('button',{name:'确认移除分类'}));
 fireEvent.click(await screen.findByRole('button',{name:'核对最新分类，保留输入'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'确认移除分类'})).toHaveProperty('disabled',true));
 expect(screen.getByText(/1 个历史 API/)).toBeTruthy();
 fireEvent.mouseDown(screen.getByRole('combobox',{name:'迁移目标'}));fireEvent.click(await screen.findByText('交易',{selector:'.ant-select-item-option-content'}));
 expect(screen.getByRole('button',{name:'确认移除分类'})).toHaveProperty('disabled',false);
});

test('重名是确定字段错误，修改名称即可再次保存，无须读取最新版本',async()=>{
 const source={id:'CAT_a',name:'订单',revision:1,enabled:true,draftApis:0,publishedApis:0,historicalApis:0};let attempts=0;
 const api=vi.fn(async(path:string,options?:{method?:string})=>{if(options?.method==='PUT'){if(++attempts===1)throw new AdminApiError('分类名称已存在',40000001,'r1',undefined,400);return source;}return {items:[source],total:1,page:1,pageSize:20}});
 render(<CategoryManagement api={api as AdminApi} onClose={vi.fn()} onChanged={vi.fn()}/>);
 fireEvent.click(await screen.findByRole('button',{name:'改名'}));fireEvent.change(screen.getByLabelText('分类名称'),{target:{value:'已存在'}});fireEvent.click(screen.getByRole('button',{name:'保存分类'}));await screen.findByText(/分类名称已存在/);
 fireEvent.change(screen.getByLabelText('分类名称'),{target:{value:'唯一名称'}});
 expect(screen.queryByRole('button',{name:'核对最新分类，保留输入'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'保存分类'}));await screen.findByText('分类已保存。');expect(attempts).toBe(2);
});
