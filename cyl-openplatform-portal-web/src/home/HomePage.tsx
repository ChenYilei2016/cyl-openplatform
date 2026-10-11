import { ArrowRightOutlined, KeyOutlined, SafetyCertificateOutlined, SearchOutlined, SendOutlined } from "@ant-design/icons";
import { usePortalDocumentClient } from "../documentation/PortalDocumentReader";
import { curlExample, documentOperation, javaExample, pythonExample } from "@cyl/open-platform-web-shared/documentation/invocationExamples";
import type { DocumentCategory, DocumentSummary, DocumentView } from "@cyl/open-platform-web-shared/documentation/types";
import type { Page } from "@cyl/open-platform-web-shared/http";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { useEffect, useMemo, useState } from "react";
import CodeBlock, { type CodeSample } from "../shell/CodeBlock";
import MethodBadge from "../shell/MethodBadge";
import { useReducedMotion } from "../shell/useColorMode";
import "./home.css";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface Overview {
  apiTotal: number;
  categories: DocumentCategory[];
  sample: DocumentView | null;
}

const steps = [
  { id: "credential", icon: <KeyOutlined />, title: "获取凭据", text: "在“我的接入”为本租户生成或绑定 AK，Secret 只显示一次。" },
  { id: "token", icon: <SafetyCertificateOutlined />, title: "换取 Token", text: "用 AK 与 Secret 调用 Token 接口，得到有时效的访问令牌。" },
  { id: "invoke", icon: <SendOutlined />, title: "发起调用", text: "携带 Bearer Token 调用网关地址，按文档传入业务参数。" },
];

/** 以一个真实公开 API 生成调用示例（与文档页同一生成函数），网关地址取平台配置。 */
function buildSamples(view: DocumentView, gatewayBaseUrl: string): CodeSample[] {
  const document = { ...view.document, baseUrl: gatewayBaseUrl || view.document.baseUrl };
  const operation = documentOperation(document, view);
  const samples: CodeSample[] = [];
  try {
    samples.push({ label: "cURL", language: "bash", code: curlExample(document) });
  } catch {
    /* 示例请求体无法安全放入 shell 时不展示该语言。 */
  }
  if (operation) samples.push({ label: "Java", language: "java", code: javaExample(document, operation, "BEARER") });
  try {
    samples.push({ label: "Python", language: "python", code: pythonExample(document) });
  } catch {
    /* 同上。 */
  }
  return samples;
}

/**
 * 门户首页（115）：以搜索为中心的深色门面，展示平台确有的数据（API 数、分类数），用一个真实公开 API 演示调用，
 * 三步说明接入流程，下方分类卡片进入文档。装饰动效在“减少动态效果”时不播放，信息不缺失。
 */
export default function HomePage({
  gatewayBaseUrl,
  onSearch,
  onNavigate,
  onOpenApi,
  onOpenCategory,
}: {
  gatewayBaseUrl: string;
  onSearch: () => void;
  onNavigate: (section: string, params?: Record<string, string>) => void;
  onOpenApi: (api: DocumentSummary) => void;
  onOpenCategory: (category: string) => void;
}) {
  const client = usePortalDocumentClient();
  const reducedMotion = useReducedMotion();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [sampleApi, setSampleApi] = useState<DocumentSummary | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      const [categories, apis] = await Promise.all([
        client.read<Page<DocumentCategory>>("/categories?page=1&pageSize=50", { signal }),
        client.read<Page<DocumentSummary>>("?page=1&pageSize=1", { signal }),
      ]);
      const first = apis.items[0] ?? null;
      let sample: DocumentView | null = null;
      if (first) {
        try {
          const view = await client.read<DocumentView>(`/${[first.service, first.version, first.method].map(encodeURIComponent).join("/")}/view`, { signal });
          // 只有结构完整的文档才用于演示；异常响应只隐藏演示，不影响首页其余内容。
          sample = view?.document && typeof view.document.path === "string" ? view : null;
        } catch {
          /* 示例读取失败时只隐藏代码演示。 */
        }
      }
      if (!signal.aborted) {
        setSampleApi(first);
        setOverview({ apiTotal: apis.total, categories: categories.items, sample });
      }
    })().catch((failure) => {
      if (!signal.aborted) setError((failure as Error).message);
    });
    return () => controller.abort();
  }, []);

  const samples = useMemo(() => (overview?.sample ? buildSamples(overview.sample, gatewayBaseUrl) : []), [overview?.sample, gatewayBaseUrl]);
  const response = overview?.sample
    ? stringifyJson({ code: 200, resultMsg: "成功", data: overview.sample.document.responseExample, requestId: "<本次请求标识>" }, 2)
    : "";
  // 打字机效果只播放一次：逐步显示第一个示例，切换页签或减少动态效果时直接完整显示。
  const [typed, setTyped] = useState<number | null>(null);
  const firstCode = samples[0]?.code ?? "";
  useEffect(() => {
    if (!firstCode || reducedMotion) {
      setTyped(null);
      return;
    }
    let length = 0;
    setTyped(0);
    const timer = window.setInterval(() => {
      length += Math.max(4, Math.ceil(firstCode.length / 60));
      if (length >= firstCode.length) {
        window.clearInterval(timer);
        setTyped(null);
      } else setTyped(length);
    }, 24);
    return () => window.clearInterval(timer);
  }, [firstCode, reducedMotion]);
  const shown = typed === null ? samples : samples.map((sample, index) => (index === 0 ? { ...sample, code: sample.code.slice(0, typed) } : sample));
  const popular = [...(overview?.categories ?? [])].sort((a, b) => b.apiCount - a.apiCount).slice(0, 4);
  const openGuide = (anchor: string) => {
    // 切换页面是同步 pushState；随即在同一条历史记录上补上锚点，指南挂载时即可读到并定位（不依赖下一帧回调）。
    onNavigate("guide");
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${anchor}`);
  };

  return (
    <div className="op-home" role="region" aria-label="首页">
      <section className={`op-home__hero${reducedMotion ? " is-static" : ""}`} aria-labelledby="home-title">
        <div className="op-home__glow" aria-hidden />
        <div className="op-home__hero-inner">
          <p className="op-home__eyebrow">Developer Platform</p>
          <h1 id="home-title" className="op-home__title">
            连接业务，从一个 <span className="op-home__keyword">API</span> 开始
          </h1>
          <p className="op-home__lead">统一的鉴权、文档与在线调试。按服务标识或能力搜索，找到需要的接口直接开始调用。</p>
          <button type="button" className="op-home__search" onClick={onSearch} aria-label="搜索 API">
            <SearchOutlined aria-hidden />
            <span className="op-home__search-text">搜索 API、服务标识或能力…</span>
            <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          {popular.length > 0 && (
            <p className="op-home__popular">
              <span>热门分类</span>
              {popular.map((item) => (
                <button key={item.category} type="button" onClick={() => onOpenCategory(item.category)}>
                  {item.category}
                </button>
              ))}
            </p>
          )}
          {overview && (
            <dl className="op-home__stats" aria-label="平台数据">
              <div>
                <dt>公开 API</dt>
                <dd>{overview.apiTotal}</dd>
              </div>
              <div>
                <dt>业务分类</dt>
                <dd>{overview.categories.length}</dd>
              </div>
            </dl>
          )}
          {error && <p className="op-home__error" role="alert">平台数据暂时无法读取：{error}。仍可通过搜索或“API 文档”浏览。</p>}
        </div>
        {samples.length > 0 && sampleApi && (
          <div className="op-home__demo" aria-label="调用示例">
            <div className="op-home__demo-head">
              <MethodBadge method={overview!.sample!.document.httpMethod} />
              <code>{overview!.sample!.document.path}</code>
              <button type="button" className="op-home__demo-link" onClick={() => onOpenApi(sampleApi)}>
                查看文档 <ArrowRightOutlined aria-hidden />
              </button>
            </div>
            <CodeBlock title="请求" samples={shown} maxHeight={260} />
            <CodeBlock title="返回" samples={[{ label: "JSON", language: "json", code: response }]} maxHeight={236} />
          </div>
        )}
      </section>

      <section className="op-home__steps" aria-labelledby="home-steps">
        <h2 id="home-steps" className="op-home__section-title">三步完成接入</h2>
        <ol className="op-home__step-list">
          {steps.map((step, index) => (
            <li key={step.id} className="op-home__step">
              <span className="op-home__step-index" aria-hidden>
                {index + 1}
              </span>
              <span className="op-home__step-icon" aria-hidden>
                {step.icon}
              </span>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
              <a
                href={`?section=guide#${step.id}`}
                onClick={(event) => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  openGuide(step.id);
                }}
              >
                查看详细说明 <ArrowRightOutlined aria-hidden />
              </a>
            </li>
          ))}
        </ol>
      </section>

      {overview && overview.categories.length > 0 && (
        <section className="op-home__categories" aria-labelledby="home-categories">
          <div className="op-home__section-head">
            <h2 id="home-categories" className="op-home__section-title">按分类浏览</h2>
            <button type="button" className="op-home__more" onClick={() => onNavigate("documents")}>
              全部 API 文档 <ArrowRightOutlined aria-hidden />
            </button>
          </div>
          <div className="op-home__category-grid">
            {overview.categories.map((item) => (
              <button key={item.category} type="button" className="op-home__category" onClick={() => onOpenCategory(item.category)}>
                <span className="op-home__category-mark" aria-hidden>
                  {item.category.slice(0, 1)}
                </span>
                <span className="op-home__category-name">{item.category}</span>
                <span className="op-home__category-count">{item.apiCount} 个 API</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
