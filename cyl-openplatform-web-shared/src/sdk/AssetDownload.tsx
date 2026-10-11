import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { SdkAsset, SdkClient } from './api';
import { ApiError } from '../http';
import { ErrorFeedback } from '../components';
import { stringifyJson } from '../json';

export default function AssetDownload({ asset, client, onUnavailable }: { asset: SdkAsset; client: SdkClient; onUnavailable?: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const active = useRef<{ abort: AbortController; url?: string; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const release = () => { const value = active.current; if (value) { value.abort.abort(); if (value.timer) clearTimeout(value.timer); if (value.url) URL.revokeObjectURL(value.url); active.current = null; } };
  const revision = stringifyJson(asset.revision);
  useEffect(() => {
    setBusy(false); setError(''); setNotice('');
    return () => release();
  }, [asset.id, revision, client]);
  return <div className="asset-download"><Button htmlType="button" disabled={busy || !asset.sizeBytes} onClick={() => {
    release(); const entry = { abort: new AbortController() } as NonNullable<typeof active.current>; active.current = entry;
    setBusy(true); setError(''); setNotice('');
    void client.download(asset, entry.abort.signal).then(({ blob, filename }) => {
      if (entry.abort.signal.aborted) return;
      entry.url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = entry.url; anchor.download = filename;
      document.body.append(anchor); anchor.click(); anchor.remove(); entry.timer = setTimeout(release, 1_000);
      setNotice('下载已开始。');
    }).catch(error => { if (!entry.abort.signal.aborted) { setError(error instanceof Error ? error.message : '下载失败，请刷新重试。'); if (error instanceof ApiError && (error.httpStatus === 404 || error.httpStatus === 409)) onUnavailable?.(); } }).finally(() => { if (!entry.abort.signal.aborted) setBusy(false); });
  }}>{busy ? '正在下载…' : `下载 SDK ${asset.sdkVersion}`}</Button><ErrorFeedback error={error}/>{notice && <p role="status" className="help-text">{notice}</p>}</div>;
}
