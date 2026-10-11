import { ReloadOutlined, ShareAltOutlined, RobotOutlined, RightOutlined } from "@ant-design/icons";
import { LoadFeedback, Pagination, usePage } from "@cyl/open-platform-web-shared/components";
import { usePortalDocumentClient } from "./PortalDocumentReader";
import DocumentExport from "@cyl/open-platform-web-shared/documentation/DocumentExport";
import type { DocumentSummary, DocumentView } from "@cyl/open-platform-web-shared/documentation/types";
import { sameJsonValue } from "@cyl/open-platform-web-shared/json";
import { CopyButton, StatusBadge, type StatusTone } from "@cyl/open-platform-web-shared/ui/components";
import { Button, Select } from "antd";
import { useEffect, useRef, useState } from "react";
import MethodBadge from "../shell/MethodBadge";
import StatusPage from "../shell/StatusPage";
import type { PortalNavigate } from "./CustomerDocuments";
import { pageNumber } from "./docSearch";
import McpBadge from "./McpBadge";
import PortalDocumentBody, { documentSections } from "./PortalDocumentBody";
import PublicApiDebug from "./PublicApiDebug";

const lifecycleTones = { ACTIVE: ["success", "正常"], DEPRECATED: ["warning", "已废弃"], RETIRED: ["error", "已退役"] } as const;
/** 章节顶部越过顶栏下方这条线即视为“正在阅读”。 */
const READING_LINE = 120;

/**
 * 本页目录滚动高亮：按窗口滚动计算最后一个越过阅读线的章节；点击目录立即高亮，滚动后再按位置校正。
 */
function useReadingSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join(",");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= READING_LINE) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [key]);
  return [active, setActive] as const;
}

export default function PublicDocumentDetail({
  service,
  version,
  method,
  params,
  navigate,
  refresh,
  revision,
  gatewayBaseUrl,
}: {
  service: string;
  version: string;
  method: string;
  params: URLSearchParams;
  navigate: PortalNavigate;
  refresh: () => void;
  revision: number;
  gatewayBaseUrl: string;
}) {
  const client = usePortalDocumentClient();
  const [view, setView] = useState<DocumentView | null>(null);
  const [loadedRevision, setLoadedRevision] = useState(-1);
  const loading = loadedRevision !== revision;
  const article = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const versionPage = pageNumber(params.get("versionPage"));
  const versions = usePage<DocumentSummary>(client.read, `?${new URLSearchParams({ service, method, page: String(versionPage), pageSize: "20" })}`, revision);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    void client
      .read<DocumentView>(`/${[service, version, method].map(encodeURIComponent).join("/")}/view`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setView((current) => (sameJsonValue(current, value) ? current : value));
      })
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setView(null);
          setError(reason instanceof Error ? reason.message : "文档不可用，请刷新或选择其他接口。");
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadedRevision(revision);
      });
    return () => abort.abort();
  }, [service, version, method, revision]);
  const sections = view ? documentSections.filter(({ id }) => id !== "document-errors" || view.document.errorDefinitions.length > 0) : [];
  const [reading, setReading] = useReadingSection(sections.map(({ id }) => id));
  useEffect(() => {
    if (!view) return;
    article.current?.querySelector("h1")?.focus({ preventScroll: true });
    const target = location.hash.slice(1);
    if (sections.some(({ id }) => id === target)) {
      document.getElementById(target)?.scrollIntoView?.({ block: "start" });
      setReading(target);
    }
  }, [view]);

  if (!view && error && !loading)
    return (
      <div className="op-docs__main">
        <StatusPage
          kind="error"
          title="文档暂时无法读取"
          description={
            <>
              当前正文已清除。接口可能已停用或外部版本发生变化，请刷新或从目录重新选择。
              <br />
              {error}
            </>
          }
          actions={
            <button type="button" className="op-portal-link-button" onClick={refresh}>
              刷新生效文档
            </button>
          }
        />
      </div>
    );

  const document_ = view?.document;
  const address = document_ ? (document_.baseUrl || gatewayBaseUrl || "").replace(/\/+$/, "") + document_.path : "";
  const status = document_?.lifecycle?.status ?? "ACTIVE";
  // 前端未知的生命周期状态按中性显示原值，不让整页崩溃。
  const [tone, statusLabel] = (lifecycleTones as Record<string, readonly [StatusTone, string]>)[status] ?? (["neutral", status] as const);
  return (
    <>
      <article ref={article} className="op-docs__main op-doc" aria-busy={loading}>
        <header className="op-doc__header">
          {view?.category && <p className="op-doc__crumb">{view.category}</p>}
          <div className="op-doc__title-row">
            {document_ ? <h1 tabIndex={-1}>{document_.title}</h1> : <h1 className="op-doc__placeholder">{`${service}.${method}`}</h1>}
            {document_ && <StatusBadge tone={tone}>{statusLabel}</StatusBadge>}
            {document_?.mcp && <McpBadge />}
          </div>
          {document_ && (
            <div className="op-doc__endpoint">
              <MethodBadge method={document_.httpMethod} />
              <code title={address}>{address}</code>
              <CopyButton value={address} label="接口地址" />
            </div>
          )}
          <div className="op-doc__toolbar">
            <code className="op-doc__operation">
              {service}.{method}
            </code>
            {view && (
              <Select
                aria-label="选择外部版本"
                className="op-doc__version"
                size="small"
                value={version}
                onChange={(apiVersion) => navigate({ apiVersion })}
                options={[version, ...(versions.data?.items.filter((item) => item.version !== version).map((item) => item.version) ?? [])].map((value) => ({ value, label: value }))}
              />
            )}
            <Button size="small" icon={<ReloadOutlined aria-hidden />} onClick={refresh} disabled={loading}>
              刷新生效文档
            </Button>
            {view && (
              <details className="document-share op-doc__share">
                <summary>
                  <ShareAltOutlined aria-hidden /> 导出与分享
                </summary>
                <div className="op-doc__share-panel">
                  <DocumentExport
                    disabled={loading}
                    client={client}
                    view={view}
                    onInvalidated={() => {
                      setView(null);
                      setError("文档已变化或停用，请刷新后重试。");
                    }}
                  />
                  <Button
                    size="small"
                    onClick={() => {
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(location.href);
                          setCopyNotice("文档链接已复制。");
                        } catch {
                          setCopyNotice("无法复制，请复制浏览器地址栏链接。");
                        }
                      })();
                    }}
                  >
                    复制文档链接
                  </Button>
                  {copyNotice && (
                    <p role="status" className="op-doc__help">
                      {copyNotice}
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>
          {view && <LoadFeedback loading={versions.loading} error={versions.error} retry={versions.reload} />}
          {view && versions.data && (versions.data.total > 20 || versionPage > 1) && (
            <Pagination label="外部版本分页" page={versionPage} total={versions.data.total} disabled={versions.loading} onChange={(value) => navigate({ versionPage: String(value) })} />
          )}
        </header>
        <LoadFeedback loading={loading} error={view ? error : ""} retry={refresh} />
        {document_ && <PortalDocumentBody document={document_} operation={{ service, version, method }} gatewayBaseUrl={gatewayBaseUrl} />}
      </article>
      {view && (
        <aside className="op-docs__rail" aria-label="本页目录与在线调试">
          <nav className="op-toc" aria-label="本页目录">
            <p className="op-toc__title">本页目录</p>
            {sections.map(({ id, title }) => (
              <a key={id} href={`#${id}`} aria-current={reading === id ? "location" : undefined} onClick={() => setReading(id)}>
                {title}
              </a>
            ))}
            <a
              href="#document-debug"
              className="op-toc__debug"
              onClick={() => {
                const panel = document.getElementById("document-debug");
                if (panel instanceof HTMLDetailsElement) panel.open = true;
              }}
            >
              在线调试
            </a>
          </nav>
          {document_?.mcp && (
            <details className="op-doc-mcp">
              <summary><RobotOutlined aria-hidden /><span>MCP 接入说明</span><RightOutlined className="op-doc-mcp__caret" aria-hidden /></summary>
              <section className="op-doc-mcp__content" aria-label="通过 MCP 使用">
                <p>{document_.mcp.description}</p>
                <div className="op-doc-mcp__tool">
                  <span>工具名</span>
                  <div><code>{document_.mcp.name}</code><CopyButton value={document_.mcp.name} label="MCP 工具名" /></div>
                </div>
                <p>先在“我的接入”确认本租户已开通 MCP，再到MCP 网关选择此工具。AI 客户端的连接地址与 Token 由网关提供。</p>
                {document_.employeeRequired && <p>此工具需要员工身份，MCP 网关须携带当前员工身份调用。</p>}
                <a className="op-portal-link-button op-portal-link-button--ghost" href="?section=settings">查看本租户 MCP 开通 →</a>
              </section>
            </details>
          )}
          <PublicApiDebug view={view} refreshing={loading} gatewayBaseUrl={gatewayBaseUrl} />
        </aside>
      )}
    </>
  );
}
