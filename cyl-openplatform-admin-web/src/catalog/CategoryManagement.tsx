import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Input, Select, Space, Table } from 'antd';
import { AdminApiError, type AdminApi } from '../access/api';
import { ErrorFeedback, LoadFeedback, Pagination, usePage } from '@cyl/open-platform-web-shared/components';

export interface ManagedCategory {
  id: string;
  name: string;
  revision: number;
  draftApis: number;
  publishedApis: number;
  historicalApis: number;
  enabled?: boolean;
}
/** 分类改变目录归属；不修改API草稿或发布快照。管理动作就在同一个面板完成。 */
export default function CategoryManagement({
  api,
  onClose,
  onChanged,
}: {
  api: AdminApi;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1),
    [query, setQuery] = useState('');
  const list = usePage<ManagedCategory>(
    api,
    `/api-categories?page=${page}&pageSize=20&query=${encodeURIComponent(query)}`,
  );
  const [editor, setEditor] = useState<{ kind: 'create' | 'rename' | 'remove'; category?: ManagedCategory } | null>(
    null,
  );
  const [name, setName] = useState(''),
    [targetId, setTargetId] = useState<string>();
  const [targetSearch, setTargetSearch] = useState(''),
    [targetPage, setTargetPage] = useState(1);
  const targets = usePage<ManagedCategory>(
    api,
    `/api-categories?page=${targetPage}&pageSize=20&query=${encodeURIComponent(targetSearch)}`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [needsCheck, setNeedsCheck] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const editorPanel = useRef<HTMLElement>(null);
  const dirty =
    editor?.kind === 'remove'
      ? !!targetId
      : !!editor && name.trim() !== (editor.kind === 'rename' ? editor.category!.name : '');
  useEffect(() => {
    if (editor) {
      editorPanel.current?.scrollIntoView?.({ block: 'start' });
      editorPanel.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    }
  }, [editor?.kind, editor?.category?.id]);
  useEffect(() => () => pending.current?.abort(), []);
  const edit = (kind: 'create' | 'rename' | 'remove', category?: ManagedCategory) => {
    if (dirty && !window.confirm('切换操作会放弃当前编辑，是否继续？')) return;
    setEditor({ kind, category });
    setName(kind === 'rename' ? category!.name : '');
    setTargetId(undefined);
    setError('');
    setNeedsCheck(false);
    setNotice('');
  };
  const changed = () => {
    list.reload();
    targets.reload();
    onChanged();
  };
  async function submit() {
    if (!editor || pending.current || needsCheck) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError('');
    try {
      if (editor.kind === 'create')
        await api('/api-categories', { method: 'POST', body: { name: name.trim() }, signal: abort.signal });
      else if (editor.kind === 'rename')
        await api(`/api-categories/${editor.category!.id}`, {
          method: 'PUT',
          body: { name: name.trim(), expectedRevision: editor.category!.revision },
          signal: abort.signal,
        });
      else
        await api(`/api-categories/${editor.category!.id}/remove`, {
          method: 'POST',
          body: { targetId: targetId || null, expectedRevision: editor.category!.revision },
          signal: abort.signal,
        });
      if (!abort.signal.aborted) {
        setNotice(editor.kind === 'remove' ? '分类已移除，指定的引用已迁移。' : '分类已保存。');
        setEditor(null);
        changed();
      }
    } catch (reason) {
      if (!abort.signal.aborted) {
        setError((reason as Error).message);
        setNeedsCheck(editor.kind !== 'create' && !(reason instanceof AdminApiError && reason.httpStatus === 400));
      }
    } finally {
      if (!abort.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  async function reconcile() {
    if (!editor?.category || pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError('');
    try {
      const value = await api<ManagedCategory>(`/api-categories/${editor.category.id}`, { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (value.enabled === false) {
        setEditor(null);
        setNotice('此分类已移除，请核对更新后的列表。');
      } else {
        setEditor({ ...editor, category: { ...editor.category, ...value } });
        setNotice(`已核对当前名称“${value.name}”，你的输入已保留；请确认后再提交。`);
      }
      setNeedsCheck(false);
      changed();
    } catch (reason) {
      if (!abort.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!abort.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  const used = !!editor?.category && (editor.category.draftApis > 0 || editor.category.publishedApis > 0 || editor.category.historicalApis > 0);
  return (
    <Drawer
      title="分类管理"
      open
      size={900}
      onClose={() => {
        if (!busy && (!dirty || window.confirm('放弃当前分类编辑并关闭？'))) onClose();
      }}
      maskClosable={!busy}
      closable={!busy}
    >
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Input.Search
          aria-label="搜索分类"
          placeholder="搜索分类名称"
          allowClear
          onSearch={(value) => {
            setQuery(value);
            setPage(1);
          }}
        />
        <Button type="primary" disabled={busy} onClick={() => edit('create')}>
          新建分类
        </Button>
      </Space>
      {editor && (
        <section ref={editorPanel} className="panel" aria-label="分类编辑" style={{ padding: 16, marginBottom: 16 }}>
          <h3>
            {editor.kind === 'create'
              ? '新建分类'
              : editor.kind === 'rename'
                ? `修改分类 · ${editor.category!.name}`
                : `合并或删除 · ${editor.category!.name}`}
          </h3>
          {editor.kind !== 'remove' ? (
            <label>
              分类名称
              <Input
                autoFocus
                aria-label="分类名称"
                value={name}
                maxLength={100}
                disabled={busy}
                onChange={(event) => { setName(event.target.value); if (!needsCheck) setError(''); }}
              />
            </label>
          ) : (
            <>
              <p>
                当前引用：{editor.category!.draftApis} 个草稿 API、{editor.category!.publishedApis} 个发布 API、{editor.category!.historicalApis} 个历史 API。
                {used ? '须选择迁移目标后移除。' : '无引用时可直接删除，也可合并名称。'}
              </p>
              <label>
                迁移目标{used ? '（必选）' : '（可选）'}
                <Select
                  aria-label="迁移目标"
                  style={{ width: '100%' }}
                  value={targetId}
                  allowClear
                  disabled={busy}
                  placeholder="搜索并选择另一个分类"
                  showSearch={{
                    filterOption: false,
                    onSearch: (value) => {
                      setTargetSearch(value);
                      setTargetPage(1);
                    },
                  }}
                  onChange={setTargetId}
                  options={(targets.data?.items ?? [])
                    .filter((item) => item.id !== editor.category?.id)
                    .map((item) => ({ value: item.id, label: item.name }))}
                  popupRender={(menu) => (
                    <>
                      {menu}
                      <LoadFeedback {...targets} retry={targets.reload} />
                      {targets.data && targets.data.total > 20 && (
                        <Pagination
                          label="迁移分类分页"
                          page={targetPage}
                          total={targets.data.total}
                          onChange={setTargetPage}
                        />
                      )}
                    </>
                  )}
                />
              </label>
              <p className="help-text">
                改名与合并立即调整目录展示，接口版本、调用地址和权限保持不变。历史分类名称保留用于解析旧快照。
              </p>
            </>
          )}
          <ErrorFeedback error={error} />
          {needsCheck && (
            <Button onClick={() => void reconcile()} disabled={busy}>
              核对最新分类，保留输入
            </Button>
          )}
          <Space style={{ marginTop: 12 }}>
            <Button
              disabled={busy}
              onClick={() => {
                setEditor(null);
                setError('');
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              danger={editor.kind === 'remove'}
              loading={busy}
              disabled={needsCheck || (editor.kind === 'remove' ? used && !targetId : !name.trim())}
              onClick={() => void submit()}
            >
              {editor.kind === 'remove' ? '确认移除分类' : '保存分类'}
            </Button>
          </Space>
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
      <LoadFeedback {...list} retry={list.reload} />
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={list.data?.items ?? []}
        columns={[
          { title: '分类名称', dataIndex: 'name' },
          { title: '草稿 API', dataIndex: 'draftApis', width: 100 },
          { title: '发布 API', dataIndex: 'publishedApis', width: 100 },
          { title: '历史 API', dataIndex: 'historicalApis', width: 100 },
          {
            title: '操作',
            width: 180,
            render: (_, item) => (
              <Space>
                <Button type="link" disabled={busy} onClick={() => edit('rename', item)}>
                  改名
                </Button>
                <Button type="link" disabled={busy} onClick={() => edit('remove', item)}>
                  合并 / 删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      {list.data && (
        <Pagination
          label="分类管理分页"
          page={page}
          total={list.data.total}
          onChange={setPage}
          disabled={busy || list.loading}
        />
      )}
    </Drawer>
  );
}
