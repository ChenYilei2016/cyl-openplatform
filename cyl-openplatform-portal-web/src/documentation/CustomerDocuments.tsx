import type { DocumentSummary } from "@cyl/open-platform-web-shared/documentation/types";
import { PlatformTheme } from "@cyl/open-platform-web-shared/ui/PlatformTheme";
import { lazy, Suspense, useEffect, useState } from "react";
import HomePage from "../home/HomePage";
import PortalShell, { portalSections } from "../shell/PortalShell";
import StatusPage from "../shell/StatusPage";
import { useColorMode } from "../shell/useColorMode";
import PublicDocuments from "./PublicDocuments";
import PortalDocumentReader, { usePortalDocumentScope } from "./PortalDocumentReader";
const Portal = lazy(() => import("../portal/Portal"));
const PublicSdkCenter = lazy(() => import("../sdk/PublicSdkCenter"));
const IntegrationGuide = lazy(() => import("./IntegrationGuide"));
const BearerDocuments = lazy(() => import("./BearerDocuments"));

/** replace：输入即搜等连续变化只替换当前历史记录，避免返回键逐字回退。 */
export type PortalNavigate = (changes: Record<string, string | null>, reset?: boolean, replace?: boolean) => void;

/** 文档参数：带具体 API 或筛选条件的链接直接进入 API 文档（115 用户故事 6）。 */
const documentParams = ["apiService", "apiMethod", "service", "method", "version", "query", "category", "mcpOnly"];

export default function CustomerDocuments() {
  const color = useColorMode();
  useEffect(() => {
    document.documentElement.dataset.opMode = color.mode;
  }, [color.mode]);
  return (
    <PlatformTheme variant="portal" mode={color.mode}>
      <Suspense fallback={<p role="status" className="op-portal-loading">正在加载页面…</p>}>
        {/^\/docs\/?$/.test(location.pathname) ? <BearerDocuments /> : <PortalDocumentReader><PublicPortal preference={color.preference} onPreference={color.setPreference} /></PortalDocumentReader>}
      </Suspense>
    </PlatformTheme>
  );
}

function PublicPortal({ preference, onPreference }: { preference: ReturnType<typeof useColorMode>["preference"]; onPreference: ReturnType<typeof useColorMode>["setPreference"] }) {
  const documentScope = usePortalDocumentScope();
  const [search, setSearch] = useState(location.search);
  useEffect(() => {
    const restore = () => setSearch(location.search);
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const params = new URLSearchParams(search);
  const section = params.get("section") || (documentParams.some((name) => params.get(name)) ? "documents" : "home");
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const needsAddress = section === "guide" || section === "sdk" || section === "home" || section === "documents";
  useEffect(() => {
    if (!needsAddress || gatewayBaseUrl) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/platform-info", { signal: abort.signal, cache: "no-store", credentials: "omit" });
        const result = await response.json();
        if (!abort.signal.aborted && response.ok && result.code === 200) setGatewayBaseUrl(result.data?.gatewayBaseUrl || "");
      } catch {
        /* 地址读取不可用时示例保留环境变量占位。 */
      }
    })();
    return () => abort.abort();
  }, [needsAddress, gatewayBaseUrl]);
  const navigate: PortalNavigate = (changes, reset = false, replace = false) => {
    const next = reset ? new URLSearchParams() : new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const url = `${location.pathname}${next.size ? `?${next}` : ""}`;
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    setSearch(location.search);
    if (!replace) window.scrollTo?.({ top: 0 });
  };
  const openSection = (target: string, extra: Record<string, string> = {}) => navigate(target === "home" ? extra : { section: target, ...extra }, true);
  const openApi = (api: DocumentSummary) => navigate({ section: "documents", category: api.category || null, apiService: api.service, apiVersion: api.version, apiMethod: api.method }, true);
  const known = portalSections.some((item) => item.section === section);
  return (
    <PortalShell section={section} preference={preference} onPreference={onPreference} onNavigate={(target) => openSection(target)} onOpenApi={openApi} paletteOpen={paletteOpen} onPaletteOpen={setPaletteOpen}>
      {/* 懒加载页面只在内容区等待，顶栏与 ⌘K 始终可用。 */}
      <Suspense fallback={<p role="status" className="op-portal-loading">正在加载页面…</p>}>
      {!known ? (
        <StatusPage
          kind="notFound"
          description="地址中的页面不存在，可能链接已过期。可以回到首页，或直接搜索需要的 API。"
          actions={
            <>
              <a className="op-portal-link-button" href="?section=documents" onClick={(event) => { event.preventDefault(); openSection("documents"); }}>浏览 API 文档</a>
              <a className="op-portal-link-button op-portal-link-button--ghost" href={location.pathname} onClick={(event) => { event.preventDefault(); openSection("home"); }}>回到首页</a>
            </>
          }
        />
      ) : section === "home" ? (
        <HomePage key={documentScope} gatewayBaseUrl={gatewayBaseUrl} onSearch={() => setPaletteOpen(true)} onNavigate={openSection} onOpenApi={openApi} onOpenCategory={(category) => navigate({ section: "documents", category }, true)} />
      ) : section === "settings" ? (
        <Portal embedded />
      ) : section === "sdk" ? (
        <PublicSdkCenter params={params} navigate={navigate} gatewayBaseUrl={gatewayBaseUrl} />
      ) : section === "guide" ? (
        <IntegrationGuide gatewayBaseUrl={gatewayBaseUrl} />
      ) : (
        <PublicDocuments key={documentScope} params={params} navigate={navigate} gatewayBaseUrl={gatewayBaseUrl} />
      )}
      </Suspense>
    </PortalShell>
  );
}
