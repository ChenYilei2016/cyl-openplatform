import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Input, Select, Space, Popover } from 'antd';
import type { AdminApi } from '../access/api';
import { ErrorFeedback, LoadFeedback, Pagination } from '@cyl/open-platform-web-shared/components';
import { useReadPage } from '@cyl/open-platform-web-shared/ui/useReadPage';
import EmployeeProfileSearch, {
  type EmployeeProfileOption,
} from '@cyl/open-platform-web-shared/employees/EmployeeProfileSearch';
import CategoryManagement from './CategoryManagement';
import './editors.css';

export const isOwnerReference = (value: string) =>
  /^(?:EMP_[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(value);

type FieldProps = { api: AdminApi; value: string; onChange: (value: string) => void; label?: string;
  /** 外层表单已有标签时隐藏组件自带标签（110 快速创建）。 */
  hideLabel?: boolean; id?: string; status?: 'error' };
export function CategoryPicker({ api, value, onChange, label = '展示分类', hideLabel = false, id, status }: FieldProps) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [page, setPage] = useState(1),
    [managing, setManaging] = useState(false),
    [revision, setRevision] = useState(0),
    [display, setDisplay] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const categories = useReadPage<string>(
    api,
    `/apis/categories?page=${page}&pageSize=20&query=${encodeURIComponent(filter)}`,
    revision,
    open,
  );
  useEffect(() => {
    const abort = new AbortController();
    setDisplay(value);
    if (value)
      void api<string>(`/api-categories/resolve?name=${encodeURIComponent(value)}`, { signal: abort.signal })
        .then((name) => {
          if (!abort.signal.aborted && typeof name === 'string') setDisplay(name);
        })
        .catch(() => {});
    return () => abort.abort();
  }, [api, value, revision]);
  const options = (categories.data?.items ?? []).map((name) => ({
    value: value && name === display ? value : name,
    label: name,
  }));
  if (value && !options.some((option) => option.value === value)) options.unshift({ value, label: display });
  const select = (
    <Select
      id={id}
      status={status}
      aria-label={label}
      value={value || undefined}
      placeholder="搜索并选择已维护的分类"
      style={{ width: '100%' }}
      open={open}
      onOpenChange={setOpen}
      onChange={onChange}
      showSearch={{ filterOption: false, onSearch: setSearch }}
      options={options}
      popupRender={(menu) => (
        <>
          {menu}
          <LoadFeedback {...categories} retry={categories.reload} />
          {categories.data && categories.data.total > 20 && (
            <Pagination label="分类选择分页" page={page} total={categories.data.total} onChange={setPage} />
          )}
        </>
      )}
    />
  );
  const manage = () => {
    setOpen(false);
    setManaging(true);
  };
  return (
    <div className={hideLabel ? undefined : 'workspace-category'}>
      {hideLabel ? (
        <Space.Compact block>
          {select}
          <Button onClick={manage}>管理分类</Button>
        </Space.Compact>
      ) : (
        <>
          <label>
            <span className="field-label">
              {label} <span className="required-mark">*</span>
            </span>
            {select}
          </label>
          <Button className="workspace-category-manage" type="link" size="small" onClick={manage}>
            管理分类
          </Button>
        </>
      )}
      {managing && (
        <CategoryManagement
          api={api}
          onClose={() => setManaging(false)}
          onChanged={() => setRevision((value) => value + 1)}
        />
      )}
    </div>
  );
}
export function OwnerPicker({ api, value, onChange, onDefault, purpose = 'maintenance', label = '负责人', hideLabel = false, id, status }: FieldProps & { onDefault?: (value: string) => void; purpose?: 'maintenance' | 'filter' }) {
  const [profile, setProfile] = useState<EmployeeProfileOption | null>(null),
    [open, setOpen] = useState(false),
    [employeeNo, setEmployeeNo] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [readError, setReadError] = useState(''), [readRevision, setReadRevision] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const change = useRef(onDefault ?? onChange);
  change.current = onDefault ?? onChange;
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    setProfile(null);
    setReadError('');
    if ((!value && purpose === 'filter') || value && !isOwnerReference(value)) return () => abort.abort();
    void api<EmployeeProfileOption>(value ? `/apis/owners/${encodeURIComponent(value)}` : '/apis/owners/current', {
      signal: abort.signal,
    })
      .then((next) => {
        if (abort.signal.aborted || !next?.id) return;
        setProfile(next);
        if (!value) change.current(next.id);
      })
      .catch((reason) => { if (!abort.signal.aborted) setReadError((reason as Error).message); });
    return () => abort.abort();
  }, [api, value, readRevision, purpose]);
  async function choose(number: string, expectedEmployeeId?: string) {
    if (pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError('');
    try {
      const found = await api<EmployeeProfileOption>('/apis/owners/verify', {
        method: 'POST',
        body: { employeeNo: number.trim(), expectedEmployeeId },
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (!found?.id) throw new Error('未取得有效人员引用，请重试核验。');
      setProfile(found);
      onChange(found.id);
      setOpen(false);
      setEmployeeNo('');
    } catch (reason) {
      if (!abort.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!abort.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div data-field-path="/owner" className="workspace-owner">
      {!hideLabel && <div className="owner-label">
        <span className="field-label">
          {label} {purpose === 'maintenance' && <span className="required-mark">*</span>}
        </span>
        <Popover
          trigger="click"
          title="负责人"
          content={
            <div style={{ maxWidth: 320 }}>
              {purpose === 'filter' ? '按已登记的负责人档案筛选，不核验或修改人员资料。' : '搜索并选择实际人员，保存其人员身份作为维护联系人。'}
              {profile && <p>人员引用：{profile.id}</p>}
            </div>
          }
        >
          <Button type="text" size="small" aria-label="负责人说明">
            ?
          </Button>
        </Popover>
      </div>}
      <Space.Compact block>
        <Input
          id={id}
          status={status}
          aria-label={label}
          aria-invalid={!!value && !isOwnerReference(value)}
          value={
            profile
              ? `${profile.displayName} · 工号 ${profile.employeeNo}`
              : value
          }
          readOnly
          placeholder="选择接口负责人"
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        />
        <Button
          aria-label="搜索人员"
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          选择人员
        </Button>
      </Space.Compact>
      {value && !isOwnerReference(value) && (
        <small className="help-text">原记录仅有名称，请选择具体人员。</small>
      )}
      {readError && (
        <>
          <ErrorFeedback error={readError} />
          <Button size="small" onClick={() => setReadRevision((n) => n + 1)}>
            重试读取负责人
          </Button>
        </>
      )}
      <Drawer
        title="选择负责人"
        open={open}
        size={900}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        closable={!busy}
        maskClosable={!busy}
        destroyOnHidden
      >
        <div
          aria-busy={busy}
          inert={busy}
          onSubmit={(event) => event.stopPropagation()}
        >
          <EmployeeProfileSearch
            api={api}
            path="/apis/owners"
            tenantLabel="当前管理租户"
            selectionLabel={purpose === 'filter' ? '选择' : '选择并核验'}
            onSelect={(person) => {
              if (purpose === 'maintenance') void choose(person.employeeNo, person.employeeId);
              else if (person.id) {
                setProfile(person);
                onChange(person.id);
                setOpen(false);
              } else setError('人员档案缺少引用，请刷新目录后重试。');
            }}
          />
          {purpose === 'maintenance' && <form
            onSubmit={(event) => {
              event.preventDefault();
              void choose(employeeNo);
            }}
          >
            <h3>未登记人员按工号核验</h3>
            <Space>
              <Input
                aria-label="负责人完整工号"
                value={employeeNo}
                maxLength={64}
                onChange={(event) => setEmployeeNo(event.target.value)}
                placeholder="输入完整工号"
              />
              <Button htmlType="submit" disabled={!employeeNo.trim()}>
                核验并选择
              </Button>
            </Space>
          </form>}
        </div>
        {busy && <p role="status">正在核验人员…</p>}
        <ErrorFeedback error={error} />
      </Drawer>
    </div>
  );
}
