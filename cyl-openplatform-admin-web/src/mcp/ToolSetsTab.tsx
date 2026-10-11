import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { ConfirmAction, EmptyState, EntityDrawer, FormSection, IdText, ReadonlyField, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { DataTable, FilterBar, useDebouncedCallback, type DataTableColumn } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { App, Button, Form, Input, Space, Switch, Tag } from "antd";
import { useEffect, useState } from "react";
import type { AdminApi } from "../access/api";
import { useListQuery } from "../navigation/useListQuery";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import type { McpTool, McpToolSet, McpToolSetDetail } from "./model";
import ToolsTab from "./ToolsTab";

type Values = { code: string; name: string; description: string; enabled: boolean };

function SetEditor({ api, initial, onClose, onSaved }: { api: AdminApi; initial: McpToolSetDetail | null; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<Values>();
  const { modal } = App.useApp();
  const [selected, setSelected] = useState(initial?.apiIds ?? []);
  const [names, setNames] = useState(initial?.apiNames ?? {});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigation = useAdminNavigation();
  useEffect(() => {
    if (!dirty && !busy) return;
    const unregister = navigation.registerDraft({ mcpToolSet: true, dirty: () => dirty, busy: () => busy, save: async () => false,
      canSave: false, leaveMessage: "工具集修改尚未保存，请返回抽屉保存，或明确放弃后离开。" });
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { unregister(); window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, busy, navigation.registerDraft]);
  const change = (tool: McpTool, included: boolean) => {
    setDirty(true);
    setSelected(values => included ? [...values, tool.apiId] : values.filter(id => id !== tool.apiId));
    setNames(values => ({ ...values, [tool.apiId]: tool.title }));
  };
  const close = () => {
    if (busy) return;
    if (!dirty) { onClose(); return; }
    modal.confirm({ title: "放弃未保存的修改？", content: "本次工具集配置和成员修改尚未保存。", okText: "放弃修改", cancelText: "继续编辑", onOk: onClose });
  };
  const save = async (values: Values) => {
    setBusy(true); setError("");
    try {
      const { code, ...fields } = values;
      await api(initial ? `/mcp/tool-sets/${encodeURIComponent(initial.toolSet.id)}` : "/mcp/tool-sets", {
        method: initial ? "PUT" : "POST", body: { ...fields, apiIds: selected, ...(initial ? { expectedRevision: initial.toolSet.revision } : { code }) },
      });
      onSaved();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <EntityDrawer open title={initial ? initial.toolSet.name : "创建工具集"} subtitle="一个分类地址，共用网关凭据；成员选择不改变租户权限。" width="lg" onClose={close}
    footer={<Space><Button disabled={busy} onClick={close}>取消</Button><Button type="primary" loading={busy} onClick={() => form.submit()}>保存工具集</Button></Space>}>
    <ErrorFeedback error={error} />
    <Form form={form} layout="vertical" initialValues={initial?.toolSet ?? { code: "", name: "", description: "", enabled: true }} onValuesChange={() => setDirty(true)} onFinish={save} disabled={busy}>
      <FormSection title="基本信息" columns={2}>
        {initial ? <ReadonlyField label="工具集代码" value={initial.toolSet.code} /> : <Form.Item name="code" label="工具集代码" rules={[{ required: true, pattern: /^[a-z][a-z0-9_-]{0,63}$/, message: "以小写字母开头，仅含小写字母、数字、下划线或短横线" }]}><Input maxLength={64} placeholder="例如 orders" /></Form.Item>}
        <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请填写名称" }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea maxLength={500} autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
        <Form.Item name="enabled" label="启用工具集" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
      </FormSection>
    </Form>
    <FormSection title={`成员工具 · ${selected.length}/200`} columns={1} stacked>
      <div className="mcp-selected-tools">{selected.length ? selected.map(id => <Tag key={id} closable={!busy} onClose={() => { setDirty(true); setSelected(values => values.filter(value => value !== id)); }}>{names[id] || id}</Tag>) : <span className="op-muted">尚未选择工具，可以先创建空工具集。</span>}</div>
      <ToolsTab api={api} selected={selected} onSelect={change} disabled={busy} />
    </FormSection>
  </EntityDrawer>;
}

export default function ToolSetsTab({ api, onChanged }: { api: AdminApi; onChanged: () => void }) {
  const query = useListQuery({ namespace: "mcpSets", defaults: { query: "" } });
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ initial: McpToolSetDetail | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [searchText, setSearchText] = useState(query.filters.query);
  const search = useDebouncedCallback((value: string) => query.setFilter("query", value));
  useEffect(() => setSearchText(query.filters.query), [query.filters.query]);
  const list = useReadPage<McpToolSet>(api, `/mcp/tool-sets?${new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), query: query.filters.query })}`, revision);
  const edit = async (set: McpToolSet) => {
    setBusy(set.id); setError("");
    try { setEditor({ initial: await api<McpToolSetDetail>(`/mcp/tool-sets/${encodeURIComponent(set.id)}`) }); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  };
  const remove = async (set: McpToolSet) => {
    setBusy(set.id); setError("");
    try { await api(`/mcp/tool-sets/${encodeURIComponent(set.id)}?expectedRevision=${set.revision}`, { method: "DELETE" }); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); setRevision(value => value + 1); onChanged(); }
  };
  const columns: DataTableColumn<McpToolSet>[] = [
    { key: "name", title: "工具集", hideable: false, render: set => <div><Button type="link" disabled={busy !== null} onClick={() => edit(set)}>{set.name}</Button><div className="op-cell-sub">{set.description}</div></div> },
    { key: "address", title: "MCP地址路径", render: set => <IdText value={`/mcp/v1/sets/${set.code}`} /> },
    { key: "enabled", title: "状态", width: 105, render: set => <StatusBadge tone={set.enabled ? "success" : "neutral"}>{set.enabled ? "启用" : "已停用"}</StatusBadge> },
    { key: "actions", title: "操作", width: 100, render: set => <ConfirmAction title={`删除工具集「${set.name}」？`} description="分类地址将不可用，API本身不受影响。" okText="删除" danger onConfirm={() => remove(set)}><Button type="link" danger disabled={busy !== null}>删除</Button></ConfirmAction> },
  ];
  return <section className="mcp-sets" aria-label="MCP工具集">
    <div className="mcp-section__head"><p className="mcp-section__intro">按业务分类提供独立 MCP 地址。网关可分别装载，工具的租户权限仍由平台统一校验。</p>
      <Space><Button icon={<ReloadOutlined />} aria-label="刷新工具集" onClick={list.reload} /><Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ initial: null })}>创建工具集</Button></Space></div>
    <ErrorFeedback error={error} />
    <FilterBar search={<Input.Search aria-label="搜索工具集" placeholder="按名称或代码搜索" allowClear value={searchText}
      onChange={event => { setSearchText(event.target.value); search.run(event.target.value); }} onSearch={value => search.flush(value)} />}
      chips={query.filters.query ? [{ key: "query", text: `搜索：${query.filters.query}`, label: `搜索：${query.filters.query}`, onRemove: () => query.clear() }] : []} onClearAll={() => query.clear()} />
    <DataTable caption="MCP工具集列表" rowKey={set => set.id} data={list.data?.items ?? []} columns={columns} loading={list.loading}
      pagination={list.data ? { page: query.page, pageSize: query.pageSize, total: list.data.total, onChange: (page, size) => size !== query.pageSize ? query.setPageSize(size) : query.setPage(page) } : undefined}
      empty={list.error ? <EmptyState kind="error" title="工具集读取失败" description={list.error} action={<Button onClick={list.reload}>重试</Button>} /> : query.filters.query
        ? <EmptyState kind="noResult" title="没有匹配的工具集" action={<Button onClick={() => query.clear()}>清除筛选</Button>} />
        : <EmptyState title="暂无工具集" description="创建工具集，为一组已发布工具提供分类地址。" action={<Button onClick={() => setEditor({ initial: null })}>创建工具集</Button>} />} />
    {editor && <SetEditor api={api} initial={editor.initial} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setRevision(value => value + 1); onChanged(); }} />}
  </section>;
}
