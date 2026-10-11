import { FileTextOutlined, LoadingOutlined, SearchOutlined } from "@ant-design/icons";
import { usePortalDocumentClient } from "../documentation/PortalDocumentReader";
import type { DocumentSummary } from "@cyl/open-platform-web-shared/documentation/types";
import type { Page } from "@cyl/open-platform-web-shared/http";
import { Modal } from "antd";
import { useEffect, useRef, useState } from "react";

const SEARCH_DELAY = 200;

export interface PaletteSection {
  section: string;
  label: string;
  hint: string;
}
type Item = { key: string; group: string; title: string; hint: string; run: () => void };

/**
 * 门户 ⌘K：输入即搜索公开 API（名称、服务标识、能力），回车直接打开文档；也可跳转到门户各页。
 * 只读公开文档接口，不需要登录。
 */
export default function PortalCommandPalette({
  open,
  onClose,
  sections,
  onOpenSection,
  onOpenApi,
}: {
  open: boolean;
  onClose: () => void;
  sections: PaletteSection[];
  onOpenSection: (section: string) => void;
  onOpenApi: (api: DocumentSummary) => void;
}) {
  const client = usePortalDocumentClient();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ keyword: string; items: DocumentSummary[]; total: number; error: string } | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const keyword = text.trim();
  useEffect(() => {
    if (open) {
      setText("");
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);
  useEffect(() => {
    if (!open || !keyword) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      client
        .read<Page<DocumentSummary>>(`?${new URLSearchParams({ query: keyword, page: "1", pageSize: "8" })}`, { signal: controller.signal })
        .then((page) => setResult({ keyword, items: page.items, total: page.total, error: "" }))
        .catch((failure) => {
          if (!controller.signal.aborted) setResult({ keyword, items: [], total: 0, error: (failure as Error).message });
        });
    }, SEARCH_DELAY);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, keyword]);
  const current = result && result.keyword === keyword ? result : null;
  const searching = Boolean(keyword) && !current;
  const pages = sections
    .filter((item) => !keyword || `${item.label}${item.hint}`.toLowerCase().includes(keyword.toLowerCase()))
    .map<Item>((item) => ({ key: `section:${item.section}`, group: "页面", title: item.label, hint: item.hint, run: () => onOpenSection(item.section) }));
  const apis = (current?.items ?? []).map<Item>((item) => ({
    key: `api:${item.service}/${item.version}/${item.method}`,
    group: "API",
    title: item.name,
    hint: `${item.service}.${item.method} · ${item.version}`,
    run: () => onOpenApi(item),
  }));
  const items = [...apis, ...pages];
  useEffect(() => setActive(0), [keyword, current?.items.length]);
  const choose = (item?: Item) => {
    if (!item) return;
    onClose();
    item.run();
  };
  return (
    <Modal open={open} onCancel={onClose} footer={null} closable={false} width={600} className="op-portal-palette" styles={{ container: { padding: 0, overflow: "hidden" } }} destroyOnHidden title={null} aria-label="搜索 API">
      <label className="op-portal-palette__search">
        <SearchOutlined aria-hidden />
        <input
          ref={input}
          aria-label="搜索 API"
          placeholder="搜索 API 名称、服务标识或能力…"
          maxLength={100}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((value) => Math.min(items.length - 1, value + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((value) => Math.max(0, value - 1));
            } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              choose(items[active]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </label>
      <div className="op-portal-palette__list" role="listbox" aria-label="搜索结果">
        {searching && (
          <p className="op-portal-palette__status" role="status">
            <LoadingOutlined aria-hidden /> 正在搜索…
          </p>
        )}
        {current?.error && (
          <p className="op-portal-palette__status op-portal-palette__status--error" role="alert">
            搜索失败：{current.error}
          </p>
        )}
        {current && !current.error && !current.items.length && <p className="op-portal-palette__status">没有匹配“{keyword}”的 API，换个关键词或服务标识试试。</p>}
        {items.map((item, index) => (
          <div key={item.key}>
            {(index === 0 || items[index - 1].group !== item.group) && <div className="op-portal-palette__group">{item.group}</div>}
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              className="op-portal-palette__item"
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
            >
              <FileTextOutlined aria-hidden />
              <span className="op-portal-palette__title">{item.title}</span>
              <span className="op-portal-palette__hint">{item.hint}</span>
            </button>
          </div>
        ))}
        {current && current.total > current.items.length && <p className="op-portal-palette__status">共 {current.total} 个匹配，可在 API 文档页查看全部。</p>}
      </div>
    </Modal>
  );
}
