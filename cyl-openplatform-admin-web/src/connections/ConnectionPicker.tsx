import { useEffect, useState } from 'react';
import { Button, Pagination, Select } from 'antd';
import { FieldHelp } from '@cyl/open-platform-web-shared/ui/components';
import type { AdminApi } from '../access/api';
import { AdminApiError } from '../access/api';
import { LoadFeedback } from '@cyl/open-platform-web-shared/components';
import { useReadPage } from '@cyl/open-platform-web-shared/ui/useReadPage';
import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import type { Binding } from '../catalog/BindingEditor';
import type { ConnectionHeader, ConnectionSummary, Diagnostics } from './types';
import ConnectionDiagnostics, { registryCheckLabel } from './ConnectionDiagnostics';
import './connections-workspace.css';

const connectionHelp = '只检查固定修订的注册中心读取权限，接口/方法由手填签名和实际测试确认。启用新连接修订不会自动升级当前API绑定。';

export default function ConnectionPicker({ api, binding, canManage = false, onSelect, hideLabel = false, id: fieldId, status }: {
  api: AdminApi; binding: Binding; canManage?: boolean; hideLabel?: boolean; id?: string; status?: 'error';
  onSelect: (binding: Binding) => void;
}) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('');
  const [summary, setSummary] = useState<ConnectionHeader | null>(null), [summaryError, setSummaryError] = useState<Error | null>(null);
  const [missingSelection, setMissingSelection] = useState<string | null>(null), [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryVersion, setSummaryVersion] = useState(0), [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Diagnostics | null>(null), [error, setError] = useState('');
  const id = binding.dubbo?.connectionId, revision = binding.dubbo?.connectionRevision;
  const selectionKey = id ? `${id}:${stringifyJson(revision)}` : null;
  const options = useReadPage<ConnectionSummary>(api,
    `/dubbo-connections/options?page=${page}&pageSize=20&query=${encodeURIComponent(filter)}`, 0, open);
  useEffect(() => {
    const timer = setTimeout(() => { setFilter(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setSummary(null); setSummaryError(null); setResult(null); setError('');
    setSummaryLoading(Boolean(id));
    if (!id) return;
    const abort = new AbortController();
    void api<ConnectionHeader>(`/dubbo-connections/${encodeURIComponent(id)}/summary`, { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) { setSummary(value); setMissingSelection(null); } })
      .catch(reason => {
        if (!abort.signal.aborted) {
          setSummaryError(reason as Error);
          if (reason instanceof AdminApiError && reason.httpStatus === 404) setMissingSelection(selectionKey);
        }
      }).finally(() => { if (!abort.signal.aborted) setSummaryLoading(false); });
    return () => abort.abort();
  }, [api, id, revision, summaryVersion]);
  useEffect(() => { setMissingSelection(null); }, [id, revision]);
  useEffect(() => { setChecking(false); }, [id, revision]);
  const [checkRequest, setCheckRequest] = useState<AbortController | null>(null);
  useEffect(() => () => checkRequest?.abort(), [checkRequest, id, revision]);
  const optionRows = (options.data?.items ?? []).filter(value => value.enabled && value.activeRevision != null && value.metadataType != null);
  const key = (connectionId: string, selectedRevision: number | null | undefined) => `${connectionId}:${stringifyJson(selectedRevision)}`;
  const choices = optionRows.map(value => ({ value: key(value.id, value.activeRevision),
    label: `${value.name} · r${stringifyJson(value.activeRevision)} · ${registryCheckLabel(value.registryCheck, value.activeRevision)}` }));
  const current = id ? key(id, revision) : undefined;
  const missingInEnvironment = selectionKey != null && missingSelection === selectionKey;
  if (id && !choices.some(value => value.value === current)) choices.unshift({ value: current!,
    label: `${summary?.name || '当前连接'} · 固定 r${stringifyJson(revision)} · ${registryCheckLabel(summary?.registryCheck, revision)}` });
  return <section className="connection-target-picker" aria-label="选择注册中心连接">
    <div className="connection-select-row">
      <div className="connection-select-field" data-field-path="/binding/dubbo/connectionId">
        {!hideLabel && <span className="field-label">注册中心连接 <span className="required-mark">*</span><FieldHelp label="连接填写">{connectionHelp}</FieldHelp></span>}
        <Select id={fieldId} status={status} aria-label="注册中心连接" value={current} placeholder="搜索并选择已启用的连接修订" disabled={checking}
          labelRender={({ label }) => id && summary ? `${summary.name} · 固定 r${stringifyJson(revision)} · ${registryCheckLabel(summary.registryCheck, revision)}` : label}
          options={choices} style={{ width: '100%' }} open={open} onOpenChange={setOpen}
          showSearch={{ filterOption: false, onSearch: setSearch }}
          onChange={value => {
            const selected = optionRows.find(row => key(row.id, row.activeRevision) === value);
            if (!selected) return;
            onSelect({ ...binding, dubbo: { ...binding.dubbo!, connectionId: selected.id, connectionRevision: selected.activeRevision } });
            setOpen(false);
          }} popupRender={menu => <>{menu}<LoadFeedback {...options} retry={options.reload} />
            {options.data && options.data.total > 20 && <Pagination simple size="small" aria-label="连接选择分页" current={page} pageSize={20} total={options.data.total} onChange={setPage} />}
          </>} />
      </div>
      <Button disabled={!id || revision == null || checking || summary?.enabled === false || missingInEnvironment} loading={checking}
        onClick={async () => {
          if (!id || revision == null || checking) return;
          const abort = new AbortController(); setCheckRequest(abort); setChecking(true); setError(''); setResult(null);
          try {
            const value = await api<Diagnostics>(`/dubbo-connections/${encodeURIComponent(id)}/diagnostics`,
              { method: 'POST', body: { revision }, signal: abort.signal });
            if (!abort.signal.aborted) {
              setResult(value);
              setSummary(currentSummary => currentSummary?.id === id ? { ...currentSummary, registryCheck: value } : currentSummary);
            }
          } catch (reason) { if (!abort.signal.aborted) setError((reason as Error).message); }
          finally { if (!abort.signal.aborted) setChecking(false); }
        }}>检查注册中心</Button>
      {hideLabel && <FieldHelp label="连接填写">{connectionHelp}</FieldHelp>}
      {canManage && <a href={`#/connections${id ? `?connection=${encodeURIComponent(id)}` : ''}`} target="_blank" rel="noopener noreferrer">管理连接 ↗</a>}
    </div>
    {summary?.enabled === false && <p role="alert" className="connection-error">连接已整体停用，请先处理连接状态。</p>}
    {summary?.activeRevision != null && stringifyJson(summary.activeRevision) !== stringifyJson(revision) && <p className="help-text">当前已启用 r{stringifyJson(summary.activeRevision)}；本API保留固定 r{stringifyJson(revision)}。</p>}
    {(summaryError || missingInEnvironment) && <span className={`connection-check-state ${missingInEnvironment ? 'failed' : 'unavailable'}`} role="status">
      <span aria-hidden />{missingInEnvironment ? '本环境连接不存在，请重新选择或处理连接。' : '连接摘要尚未确认，请重新加载后核对。'}
    </span>}
    <LoadFeedback loading={summaryLoading} error={summaryError?.message ?? ''} retry={() => setSummaryVersion(value => value + 1)} />
    {error && <p role="alert" className="connection-error">{error}</p>}
    {result && <ConnectionDiagnostics result={result} />}
  </section>;
}
