import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { Pagination, usePage } from "@cyl/open-platform-web-shared/components";
import { createSdkClient, type SdkAsset } from "@cyl/open-platform-web-shared/sdk/api";
import AssetDownload from "@cyl/open-platform-web-shared/sdk/AssetDownload";
import { Button, Input } from "antd";
import { useEffect, useState } from "react";
import type { PortalNavigate } from "../documentation/CustomerDocuments";
import { okhttpCoordinates } from "../documentation/guideExamples";
import CodeBlock from "../shell/CodeBlock";
import StatusPage from "../shell/StatusPage";
import "./sdk.css";

const client = createSdkClient({ public: true });
const filterKeys = ["query", "sdkVersion", "language"] as const;
const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("zh-CN") : "—");
const size = (bytes: number | null) => (bytes ? `${(bytes / 1024).toFixed(1)} KiB` : "—");

/**
 * 平台 Java SDK 中心（115 用户故事 16）：版本卡片（当前版本突出）、依赖坐标一键复制、更新日志时间线。
 * `?section=sdk&asset=<id>` 打开单个版本的说明与下载（管理端会链接过来）。
 */
export default function PublicSdkCenter({ params, navigate, gatewayBaseUrl }: { params: URLSearchParams; navigate: PortalNavigate; gatewayBaseUrl: string }) {
  const [revision, setRevision] = useState(0);
  const rawPage = params.get("page");
  const page = rawPage && /^\d+$/.test(rawPage) ? Math.min(5001, Math.max(1, Number(rawPage))) : 1;
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  for (const key of filterKeys) if (params.get(key)) query.set(key, params.get(key)!);
  const filtered = filterKeys.some((key) => params.get(key));
  const list = usePage<SdkAsset>(client.read, "?" + query, revision);
  const assetId = params.get("asset");
  const items = list.data?.items ?? [];
  // 只有未筛选的第一页能确定“当前版本”：取最近发布的一项（目录按登记时间倒序）。
  const current = !filtered && page === 1 && items.length ? items.reduce((latest, item) => ((item.publishedAt ?? "") > (latest.publishedAt ?? "") ? item : latest)) : undefined;
  const changelog = [...items].sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""));
  return (
    <div className="op-sdk">
      <header className="op-sdk-hero">
        <div className="op-sdk-hero__text">
          <p className="op-sdk-hero__eyebrow">DEVELOPER SDK</p>
          <h1>Java SDK 中心</h1>
          <p>选择适合运行环境的平台客户端，通过开放平台调用业务 API。下载无需登录，也不会授予任何调用权限。</p>
          <div className="op-sdk-hero__links">
            <a href="?section=guide">接入与用户级 Token →</a>
            <a href="?section=documents">查阅 API 文档 →</a>
          </div>
        </div>
        <div className="op-sdk-hero__coordinates">
          <CodeBlock title="依赖坐标" samples={okhttpCoordinates} />
          <p>平台 SDK 以 ZIP 交付、不在公共 Maven 仓库发布；它与示例代码共用上面的 OkHttp 运行依赖。下载后按包内 README 构建。</p>
        </div>
      </header>
      {assetId ? (
        <PublicSdkDetail key={`${assetId}:${revision}`} id={assetId} gatewayBaseUrl={gatewayBaseUrl} unavailable={list.reload} refresh={() => setRevision((n) => n + 1)} close={() => navigate({ asset: null })} />
      ) : (
        <>
          <form
            key={query.toString()}
            className="op-sdk-filter"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              navigate({ section: "sdk", ...Object.fromEntries(filterKeys.map((key) => [key, String(form.get(key) || "").trim()])) }, true);
            }}
          >
            <label>
              <span>SDK 名称</span>
              <Input name="query" maxLength={100} defaultValue={params.get("query") || ""} placeholder="搜索平台 SDK" />
            </label>
            <label>
              <span>SDK 版本（精确）</span>
              <Input name="sdkVersion" maxLength={32} defaultValue={params.get("sdkVersion") || ""} placeholder="例如 1.2.0" className="op-sdk-mono" />
            </label>
            <label>
              <span>语言</span>
              <Input name="language" maxLength={32} defaultValue={params.get("language") || ""} placeholder="JAVA" className="op-sdk-mono" />
            </label>
            <div className="op-sdk-filter__actions">
              <Button type="primary" htmlType="submit">查询 SDK</Button>
              <Button htmlType="button" onClick={() => navigate({ section: "sdk" }, true)}>重置</Button>
              <Button htmlType="button" icon={<ReloadOutlined aria-hidden />} onClick={() => setRevision((n) => n + 1)}>刷新 SDK</Button>
            </div>
          </form>
          {list.loading && <p role="status" className="op-sdk-loading">正在加载 SDK 版本…</p>}
          {!list.loading && list.error && (
            <StatusPage kind="error" compact description={list.error} actions={<Button onClick={list.reload}>重新加载</Button>} />
          )}
          {list.data && !items.length && (
            <StatusPage
              kind="empty"
              compact
              title="暂无匹配的已发布平台 SDK"
              description="请调整查询条件，或按接入指南直接通过 HTTP 调用。"
              actions={<a className="op-portal-link-button" href="?section=guide">查看接入指南</a>}
            />
          )}
          {list.data && items.length > 0 && (
            <>
              <section className="op-sdk-section" aria-labelledby="sdk-versions-title">
                <h2 id="sdk-versions-title">版本</h2>
                <ul className="op-sdk-versions">
                  {items.map((asset) => (
                    <li key={asset.id} className={`op-sdk-version${asset === current ? " is-current" : ""}`} aria-current={asset === current ? "true" : undefined}>
                      <div className="op-sdk-version__head">
                        <span className="op-sdk-version__number">v{asset.sdkVersion}</span>
                        {asset === current && <span className="op-sdk-version__badge">当前版本</span>}
                      </div>
                      <h3>{asset.name}</h3>
                      <dl className="op-sdk-version__meta">
                        <div><dt>运行环境</dt><dd>{asset.language} · {asset.runtime}</dd></div>
                        <div><dt>发布日期</dt><dd>{date(asset.publishedAt)}</dd></div>
                        <div><dt>下载包</dt><dd>{size(asset.sizeBytes)} · ZIP</dd></div>
                      </dl>
                      <div className="op-sdk-version__actions">
                        <AssetDownload asset={asset} client={client} onUnavailable={list.reload} />
                        <Button htmlType="button" type="link" onClick={() => navigate({ asset: asset.id })}>查看说明与下载</Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Pagination label="SDK 分页" page={page} total={list.data.total} disabled={list.loading} onChange={(value) => navigate({ page: String(value), asset: null })} />
              </section>
              <section className="op-sdk-section" aria-labelledby="sdk-changelog-title">
                <h2 id="sdk-changelog-title">更新日志</h2>
                <ol className="op-sdk-changelog">
                  {changelog.map((asset) => (
                    <li key={asset.id}>
                      <time dateTime={asset.publishedAt ?? undefined}>{date(asset.publishedAt)}</time>
                      <div>
                        <h3><span className="op-sdk-mono">v{asset.sdkVersion}</span> {asset.name}</h3>
                        <p className="op-sdk-notes">{asset.releaseNotes || "暂无版本发布说明，请以包内 README 为准。"}</p>
                        <a href={`?section=sdk&asset=${encodeURIComponent(asset.id)}`} onClick={(event) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate({ asset: asset.id }); }}>查看完整说明 →</a>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
          <details className="op-sdk-scope">
            <summary>SDK 适用范围</summary>
            <p>这里提供客户调用开放平台的客户端，不是内部提供方 SDK。SDK 版本与 API 外部版本分别选择；下载不授予业务调用权限，认证能力以具体版本说明和包内 README 为准。</p>
          </details>
        </>
      )}
    </div>
  );
}

function PublicSdkDetail({ id, refresh, close, gatewayBaseUrl, unavailable }: { id: string; unavailable: () => void; refresh: () => void; close: () => void; gatewayBaseUrl: string }) {
  const [asset, setAsset] = useState<SdkAsset | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void client
      .read<SdkAsset>("/" + encodeURIComponent(id), { signal: abort.signal })
      .then((value) => { if (!abort.signal.aborted) setAsset(value); })
      .catch((reason) => { if (!abort.signal.aborted) setError(reason.message); });
    return () => abort.abort();
  }, [id]);
  return (
    <section className="op-sdk-detail" aria-label="SDK 版本详情">
      <div className="op-sdk-detail__toolbar">
        <Button htmlType="button" icon={<ArrowLeftOutlined aria-hidden />} onClick={close}>返回 SDK 列表</Button>
        <Button htmlType="button" icon={<ReloadOutlined aria-hidden />} onClick={refresh}>刷新版本信息</Button>
      </div>
      {!asset && !error && <p role="status" className="op-sdk-loading">正在加载版本信息…</p>}
      {error && (
        <StatusPage kind="error" compact title={error} description="此版本可能已撤下或暂时不可读取，可返回列表选择其他公开版本。" actions={<Button onClick={refresh}>重新加载</Button>} />
      )}
      {asset && (
        <>
          <header className="op-sdk-detail__header">
            <div>
              <span className="op-sdk-version__number">v{asset.sdkVersion}</span>
              <h2>{asset.name}</h2>
              <p>{asset.language} · {asset.runtime} · 发布于 {date(asset.publishedAt)}</p>
            </div>
            <AssetDownload
              asset={asset}
              client={client}
              onUnavailable={() => {
                setAsset(null);
                setError("此 SDK 版本当前不可下载，请刷新版本信息或返回列表。");
                unavailable();
              }}
            />
          </header>
          <div className="op-sdk-detail__columns">
            <div>
              <h3>版本发布说明</h3>
              <p className="op-sdk-notes">{asset.releaseNotes || "暂无版本发布说明，请以包内 README 为准。"}</p>
              <h3>文件完整性与协议</h3>
              <dl className="op-sdk-integrity">
                <div><dt>文件</dt><dd>ZIP · {asset.sizeBytes} 字节</dd></div>
                <div><dt>协议</dt><dd className="op-sdk-mono">{asset.gatewayProtocol}</dd></div>
                <div><dt>SHA-256</dt><dd className="op-sdk-mono op-sdk-sha">{asset.sha256}</dd></div>
              </dl>
            </div>
            <aside className="op-sdk-detail__guide">
              <h3>开始使用</h3>
              <ol>
                <li>下载后按本版本 README 构建或引入客户端。</li>
                <li>准备应用级或用户级 Token，按接口要求选择身份。</li>
                <li>从 API 文档取得服务、外部版本、操作与请求参数。</li>
              </ol>
              {gatewayBaseUrl && <p>当前网关地址<code>{gatewayBaseUrl}</code></p>}
              <a href="?section=guide">查看接入与认证 →</a>
              <a href="?section=documents">选择要调用的 API →</a>
              <small>SDK 版本不代表 API 版本；下载不会自动取得调用权限。</small>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
