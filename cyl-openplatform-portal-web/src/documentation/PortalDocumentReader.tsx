import { createDocumentClient, type DocumentClient } from "@cyl/open-platform-web-shared/documentation/api";
import { parseJson } from "@cyl/open-platform-web-shared/json";
import { Button } from "antd";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import "./api-docs.css";

const publicClient = createDocumentClient({ public: true });
const Reader = createContext<{ client: DocumentClient; scopeKey: string }>({ client: publicClient, scopeKey: "public" });
export const usePortalDocumentClient = () => useContext(Reader).client;
export const usePortalDocumentScope = () => useContext(Reader).scopeKey;
type Identity = { tenantId: string; employeeNo: string; tenantName?: string | null };

/** 同一会话范围供首页、搜索、分类、正文与导出共用；失效或切租户时卸载旧范围的读取结果。 */
export default function PortalDocumentReader({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const expired = useCallback(() => { setIdentity(null); setNotice("登录已失效，当前只显示公共文档。"); }, []);
  const client = useMemo(() => identity ? createDocumentClient({ portal: true, onUnauthorized: expired }) : publicClient, [identity, expired]);
  const reader = useMemo(() => ({ client, scopeKey: identity ? `${identity.tenantId}:${identity.employeeNo}` : "public" }), [client, identity]);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      const response = await fetch("/portal-api/session", { credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
      if (response.status === 401 || response.status === 403) { if (!abort.signal.aborted) setIdentity(null); return; }
      const result = parseJson<{ code: number; data?: Identity }>(await response.text());
      if (!response.ok || result.code !== 200 || !result.data?.tenantId || !result.data?.employeeNo) throw new Error("会话不可用");
      if (!abort.signal.aborted) {
        const next = result.data;
        setIdentity(previous => previous?.tenantId === next.tenantId && previous.employeeNo === next.employeeNo ? previous : next);
        setNotice("");
      }
    })().catch(() => { if (!abort.signal.aborted) { setIdentity(null); setNotice("暂时无法验证登录，当前只显示公共文档。"); } });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return <>
    <div className="op-reader-scope" role="status">
      <span>{identity ? `文档范围：公共通用与 ${identity.tenantName || identity.tenantId} 已开通的 API` : notice || "文档范围：公共通用 API"}</span>
      {!identity && <a href="?section=settings">登录查看本租户 API</a>}
      {notice && <Button type="link" size="small" onClick={() => setAttempt(value => value + 1)}>重新验证</Button>}
    </div>
    <Reader.Provider value={reader}>{children}</Reader.Provider>
  </>;
}
