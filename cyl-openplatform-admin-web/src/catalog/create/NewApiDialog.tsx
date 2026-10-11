import {
  ApiOutlined,
  ArrowLeftOutlined,
  ClusterOutlined,
  CodeOutlined,
  CopyOutlined,
  FileTextOutlined,
  GlobalOutlined,
  ImportOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { EmptyState } from "@cyl/open-platform-web-shared/ui/components";
import { useDebouncedCallback } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Input, Modal, Pagination, Spin } from "antd";
import { useState, type ReactNode } from "react";
import type { AdminApi } from "../../access/api";
import type { ApiSummary } from "../CatalogPanel";
import type { CreateSource } from "./quickCreateModel";
import "./quick-create.css";

interface SourceCard {
  source: CreateSource;
  icon: ReactNode;
  title: string;
  hint: string;
}

const fromMaterial: SourceCard[] = [
  { source: "openapi", icon: <FileTextOutlined />, title: "OpenAPI 文档", hint: "勾选需要的接口，批量生成草稿" },
  { source: "curl", icon: <CodeOutlined />, title: "cURL / HTTP 请求", hint: "粘贴请求，识别地址、方法和参数" },
  { source: "dubbo", icon: <ApiOutlined />, title: "Dubbo 方法签名", hint: "粘贴 Java 方法签名，识别接口与参数类型" },
  { source: "json", icon: <ImportOutlined />, title: "平台导出 JSON", hint: "导入其他环境导出的配置，或更新已有 API" },
  { source: "copy", icon: <CopyOutlined />, title: "复制已有 API", hint: "以一个已有 API 为起点，只改名称与标识" },
];
const fromScratch: SourceCard[] = [
  { source: "http", icon: <GlobalOutlined />, title: "HTTP 接口", hint: "填写目标地址与请求方法" },
  { source: "dubbo-blank", icon: <ClusterOutlined />, title: "Dubbo 接口", hint: "选择注册中心连接并填写方法" },
];

/** 统一“新建 API”入口：一个面板列出全部来源方式（106 §6.1）。 */
export default function NewApiDialog({
  api,
  open,
  initialStep = "sources",
  onClose,
  onChoose,
  onCopy,
}: {
  api: AdminApi;
  open: boolean;
  initialStep?: "sources" | "copy";
  onClose: () => void;
  onChoose: (source: CreateSource) => void;
  onCopy: (source: ApiSummary) => void;
}) {
  const [step, setStep] = useState(initialStep);
  const card = (item: SourceCard) => (
    <button
      key={item.source}
      type="button"
      className="op-source-card"
      onClick={() => (item.source === "copy" ? setStep("copy") : onChoose(item.source))}
    >
      <span className="op-source-card__icon" aria-hidden>
        {item.icon}
      </span>
      <span className="op-source-card__text">
        <span className="op-source-card__title">{item.title}</span>
        <span className="op-source-card__hint">{item.hint}</span>
      </span>
    </button>
  );
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnHidden
      closable={{ "aria-label": "关闭新建面板" }}
      title={
        step === "copy" ? (
          <span className="op-new-api__title">
            <Button type="text" size="small" icon={<ArrowLeftOutlined />} aria-label="返回来源选择" onClick={() => setStep("sources")} />
            复制已有 API
          </span>
        ) : (
          "新建 API"
        )
      }
      className="op-new-api"
    >
      {step === "copy" ? (
        <CopyPicker api={api} onPick={onCopy} />
      ) : (
        <div className="op-new-api__body">
          <section aria-label="从已有资料">
            <h3 className="op-new-api__group">从已有资料</h3>
            <div className="op-source-grid">{fromMaterial.map(card)}</div>
          </section>
          <section aria-label="从零开始">
            <h3 className="op-new-api__group">从零开始</h3>
            <div className="op-source-grid">{fromScratch.map(card)}</div>
          </section>
          <p className="op-new-api__example">
            第一次使用？
            <Button type="link" size="small" onClick={() => onChoose("example-http")}>
              看 HTTP 示例
            </Button>
            <Button type="link" size="small" onClick={() => onChoose("example-dubbo")}>
              看 Dubbo 示例
            </Button>
          </p>
        </div>
      )}
    </Modal>
  );
}

function CopyPicker({ api, onPick }: { api: AdminApi; onPick: (source: ApiSummary) => void }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedCallback((value: string) => {
    setQuery(value.trim());
    setPage(1);
  });
  const list = useReadPage<ApiSummary>(api, `/apis?page=${page}&pageSize=8&query=${encodeURIComponent(query)}&sort=UPDATED_DESC`, 0, true, { keepPrevious: true });
  const items = list.data?.items ?? [];
  return (
    <div className="op-copy-picker">
      <Input
        autoFocus
        allowClear
        prefix={<SearchOutlined aria-hidden />}
        placeholder="搜索名称或 service.method"
        aria-label="搜索要复制的 API"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          debounced.run(event.target.value);
        }}
        onPressEnter={() => debounced.flush(text)}
      />
      <Spin spinning={list.loading && items.length > 0}>
        {list.error ? (
          <EmptyState kind="error" description={list.error} action={<Button onClick={list.reload}>重试</Button>} />
        ) : !items.length ? (
          <EmptyState kind={query ? "noResult" : "empty"} title={list.loading ? "正在加载…" : undefined} />
        ) : (
          <ul className="op-copy-picker__list" aria-label="可复制的 API">
            {items.map((item) => (
              <li key={item.id} className="op-copy-picker__item">
                <span className="op-copy-picker__main">
                  <span className="op-copy-picker__name">{item.name}</span>
                  <code className="op-copy-picker__code">
                    {item.service}.{item.method} · {item.version} · {item.protocol}
                  </code>
                </span>
                <Button size="small" onClick={() => onPick(item)} aria-label={`复制 ${item.name}`}>
                  复制
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Spin>
      {(list.data?.total ?? 0) > 8 && (
        <Pagination size="small" align="end" current={page} pageSize={8} total={list.data!.total} showSizeChanger={false} onChange={setPage} />
      )}
    </div>
  );
}
