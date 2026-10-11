import { Alert, Button, Space, Switch, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import type { AdminApi } from '../access/api';

/** 即时展示设置，不保存草稿、不提交审核。列表复用已有投影，编辑页按API读取。 */
export default function PortalVisibilitySwitch({ api, apiId, initial, disabled = false, refreshing = false }: {
  api: AdminApi; apiId: string; initial?: boolean; disabled?: boolean; refreshing?: boolean;
}) {
  const [visible, setVisible] = useState<boolean | undefined>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setVisible(initial); setError('');
    if (initial !== undefined || refreshing) return;
    const controller = new AbortController();
    void api<{ visible: boolean }>(`/apis/${encodeURIComponent(apiId)}/portal-visibility`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setVisible(value.visible); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [api, apiId, initial, retry, refreshing]);
  const change = async (value: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ visible: boolean }>(`/apis/${encodeURIComponent(apiId)}/portal-visibility`, { method: 'PUT', body: { visible: value } });
      setVisible(result.visible);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <Space direction="vertical" size={4}>
    <Tooltip title="立即生效，无需审核；关闭只隐藏门户文档，不改变正式调用权限。">
      <Switch aria-label="门户展示" size="small" checkedChildren="展示" unCheckedChildren="隐藏"
        checked={visible === true} loading={busy || (visible === undefined && !error)} disabled={disabled || refreshing || visible === undefined} onChange={value => void change(value)} />
    </Tooltip>
    {error && <Alert type="error" showIcon title={error}
      action={visible === undefined ? <Button size="small" onClick={() => setRetry(value => value + 1)}>重试读取</Button> : undefined} />}
  </Space>;
}
