import { ReloadOutlined } from '@ant-design/icons';
import { Pagination, usePage } from '@cyl/open-platform-web-shared/components';
import { createSdkClient, type SdkAsset } from '@cyl/open-platform-web-shared/sdk/api';
import AssetDownload from '@cyl/open-platform-web-shared/sdk/AssetDownload';
import { Button } from 'antd';
import { useMemo, useState } from 'react';
import StatusPage from '../shell/StatusPage';
import './sdk.css';

/** 接口绑定 SDK（历史 LEGACY_API 资产）：按当前操作列出，列表与下载都使用业务 Bearer。 */
export default function CustomerSdkAssets({ operation, token, onUnauthorized }: { operation: { service: string; version: string; method: string }; token: string; onUnauthorized: () => void }) {
  const client = useMemo(() => createSdkClient({ token, onUnauthorized }), [token, onUnauthorized]);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ service: operation.service, version: operation.version, method: operation.method, page: String(page), pageSize: '20' });
  const list = usePage<SdkAsset>(client.read, `?${query}`);
  return (
    <section className="op-sdk-assets" aria-label="适用 SDK">
      <div className="op-sdk-assets__head">
        <h3>适用 SDK 与版本发布说明</h3>
        <Button htmlType="button" size="small" icon={<ReloadOutlined aria-hidden />} onClick={list.reload}>刷新 SDK</Button>
      </div>
      <p className="op-sdk-assets__hint">适用于 {operation.service} / {operation.version} / {operation.method} 的当前生效契约。SDK 版本独立于接口版本；请选择明确版本。对外统一使用 HTTP JSON + Bearer。</p>
      {list.loading && <p role="status" className="op-sdk-assets__hint">正在加载…</p>}
      {!list.loading && list.error && <StatusPage kind="error" compact description={list.error} actions={<Button onClick={list.reload}>重新加载</Button>} />}
      {list.data && (
        <>
          {list.data.items.length ? (
            <ul className="op-sdk-assets__list">
              {list.data.items.map((asset) => (
                <li className="op-sdk-asset" key={asset.id}>
                  <h4>{asset.name}</h4>
                  <p><span className="op-sdk-mono">SDK {asset.sdkVersion}</span> · {asset.language} · {asset.runtime}</p>
                  <p>发布于 {asset.publishedAt} · {asset.sizeBytes} 字节</p>
                  <p>SHA-256 <code className="op-sdk-mono op-sdk-sha">{asset.sha256}</code></p>
                  <h5>版本发布说明</h5>
                  <p className="op-sdk-notes">{asset.releaseNotes || '暂无版本发布说明。'}</p>
                  <AssetDownload asset={asset} client={client} onUnavailable={list.reload} />
                </li>
              ))}
            </ul>
          ) : (
            <StatusPage kind="empty" compact title="此生效版本暂无已发布 SDK。" description="可直接按 API 文档中的示例通过 HTTP 调用。" />
          )}
          <Pagination label="SDK 分页" page={page} total={list.data.total} onChange={setPage} disabled={list.loading} />
        </>
      )}
    </section>
  );
}
