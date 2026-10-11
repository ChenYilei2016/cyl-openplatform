import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { ApiOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ApiClient } from '@cyl/open-platform-web-shared/http';
import { ConfirmAction, DisabledReason, IdText, PersonTag, StatusBadge } from '@cyl/open-platform-web-shared/ui/components';
import { PortalMutationError } from './api';

/** 租户 MCP 开通；租户只由服务端会话决定，请求不携带任何租户信息。 */
interface McpActivation {
  id: string;
  keyCode: string;
  status: 'ENABLED' | 'DISABLED';
  disabledByPlatform: boolean;
  activatedByEmployeeNo: string;
  activatedByName?: string | null;
  createdAt: string;
}

/** 只接受未开通（null）或完整开通记录，其他响应按读取失败处理。 */
const isActivation = (value: unknown): value is McpActivation =>
  typeof value === 'object' && value !== null && typeof (value as McpActivation).id === 'string'
  && typeof (value as McpActivation).keyCode === 'string' && ['ENABLED', 'DISABLED'].includes((value as McpActivation).status);

const timeText = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
};

/**
 * “我的接入”中的 MCP 开通卡片：本租户任意有效员工可开通一次，之后可停用/启用；
 * 平台管理员停用后只能联系平台启用。工具通过MCP 网关在 AI 客户端使用，不在门户直接调用。
 */
export default function McpActivationCard({ api }: { api: ApiClient }) {
  const [activation, setActivation] = useState<McpActivation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const writing = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await api<unknown>('/mcp/activation', { signal });
      if (signal?.aborted) return;
      if (result !== null && !isActivation(result)) throw new Error('开通状态响应不完整，请稍后重新读取。');
      setActivation(result);
      setLoaded(true);
      setError('');
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : '暂时无法读取 MCP 开通状态。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load]);

  const mutate = async (request: () => Promise<McpActivation>, success: string) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request();
      if (!isActivation(result)) throw new Error('操作结果不完整，已重新读取当前开通状态。');
      setActivation(result);
      setNotice(success);
    } catch (failure) {
      const unknown = failure instanceof PortalMutationError && failure.outcome === 'UNKNOWN';
      setError(unknown ? '未收到明确的操作结果，已重新读取当前开通状态，请核对后再操作。' : failure instanceof Error ? failure.message : '操作失败，请重试。');
      await load();
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  const open = () => mutate(() => api<McpActivation>('/mcp/activation', { method: 'POST', body: {} }), 'MCP 已开通，本租户员工可在 AI 客户端经MCP 网关使用开放平台工具。');
  const change = (enabled: boolean) =>
    mutate(() => api<McpActivation>('/mcp/activation/status', { method: 'PUT', body: { enabled } }),
      enabled ? 'MCP 已重新启用。' : 'MCP 已停用，本租户经MCP 网关的新调用将被拒绝。');

  const status = !activation ? null
    : activation.status === 'ENABLED' ? <StatusBadge tone="success">已开通</StatusBadge>
      : activation.disabledByPlatform ? <StatusBadge tone="warning">平台已停用</StatusBadge>
        : <StatusBadge tone="neutral">已停用</StatusBadge>;

  return (
    <section className="op-mcp-card" aria-labelledby="mcp-card-title">
      <span className="op-mcp-card__icon" aria-hidden><ApiOutlined /></span>
      <div className="op-mcp-card__body">
        <h2 id="mcp-card-title">MCP 开通 {status}</h2>
        <p className="op-mcp-card__hint">
          开通后，本租户可在 AI 客户端通过MCP 网关使用开放平台工具（不在门户直接调用）；可用工具以本租户权限为准。每个租户只需开通一次。
        </p>
        {activation && (
          <dl className="op-mcp-card__facts">
            <div><dt>开通编号</dt><dd><IdText value={activation.keyCode} label="开通编号" maxChars={24} /></dd></div>
            <div><dt>开通人</dt><dd><PersonTag name={activation.activatedByName} employeeNo={activation.activatedByEmployeeNo} /></dd></div>
            <div><dt>开通时间</dt><dd><time dateTime={activation.createdAt}>{timeText(activation.createdAt)}</time></dd></div>
          </dl>
        )}
        {notice && <p role="status" className="op-mcp-card__notice">{notice}</p>}
        {error && <p role="alert" className="op-mcp-card__error">{error}</p>}
      </div>
      <div className="op-mcp-card__actions">
        {!loaded && loading && <span role="status" className="op-mcp-card__hint">正在读取开通状态…</span>}
        {!loaded && !loading && <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void load()}>重新读取</Button>}
        {loaded && !activation && (
          <Button type="primary" loading={busy} disabled={loading} onClick={() => void open()}>开通 MCP</Button>
        )}
        {activation?.status === 'ENABLED' && (
          <ConfirmAction
            title="停用本租户的 MCP？"
            description="停用后本租户经MCP 网关的新调用立即被拒绝；可随时重新启用，开通编号不变。"
            okText="确认停用"
            danger
            disabled={busy || loading}
            onConfirm={() => change(false)}
          >
            <Button danger disabled={busy || loading}>停用</Button>
          </ConfirmAction>
        )}
        {activation?.status === 'DISABLED' && (
          <DisabledReason reason={activation.disabledByPlatform ? '已被平台管理员停用，请联系平台维护者启用。' : undefined}>
            <Button type="primary" loading={busy} disabled={busy || loading || activation.disabledByPlatform} onClick={() => void change(true)}>启用</Button>
          </DisabledReason>
        )}
      </div>
    </section>
  );
}
