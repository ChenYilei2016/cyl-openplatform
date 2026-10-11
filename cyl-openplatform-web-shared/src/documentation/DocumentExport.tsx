import { Button } from "antd";
import { ErrorFeedback } from "../components";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../http";
import { stringifyJson } from "../json";
import type { DocumentClient } from "./api";
import type { DocumentView } from "./types";

/** 只导出服务器重新核验的当前快照；离开文档时取消请求并释放下载资源。 */
export default function DocumentExport({
  client,
  view,
  onInvalidated,
  disabled = false,
}: {
  client: DocumentClient;
  view: DocumentView;
  onInvalidated?: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const downloads = useRef<{ abort: AbortController; release: () => void }[]>(
    [],
  );
  const versionKey = stringifyJson([
    view.releaseId,
    view.stateVersion,
    view.service,
    view.version,
    view.method,
  ]);
  useEffect(() => {
    setBusy(false);
    setError("");
    setNotice("");
    return () => {
      downloads.current.forEach((download) => {
        download.abort.abort();
        download.release();
      });
      downloads.current = [];
    };
  }, [client, versionKey]);
  const exportDocument = async (format: "JSON" | "HTML", print = false) => {
    const abort = new AbortController();
    let url: string | undefined;
    let iframe: HTMLIFrameElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (timer) clearTimeout(timer);
      iframe?.remove();
      if (url) URL.revokeObjectURL(url);
      url = undefined;
      downloads.current = downloads.current.filter(
        (value) => value.abort !== abort,
      );
    };
    downloads.current.push({ abort, release });
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const blob = await client.export(view, format, abort.signal);
      if (abort.signal.aborted) return;
      url = URL.createObjectURL(blob);
      if (print) {
        iframe = document.createElement("iframe");
        iframe.title = "文档打印预览";
        // 打印框架在屏幕外加载；内联定位使任何宿主页面都无需额外样式。
        iframe.style.cssText = "position:fixed;left:-10000px;width:1px;height:1px;border:0";
        iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
        iframe.onload = () => {
          if (abort.signal.aborted) return;
          try {
            iframe!.contentWindow!.addEventListener("afterprint", release, {
              once: true,
            });
            iframe!.contentWindow!.focus();
            iframe!.contentWindow!.print();
            setNotice("已打开浏览器打印，可选择“另存为 PDF”。");
          } catch {
            setError("浏览器未能打开打印，请下载 HTML 后使用浏览器打印。");
            release();
          }
        };
        iframe.src = url;
        document.body.append(iframe);
        timer = setTimeout(release, 120_000);
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `api-document.${format.toLowerCase()}`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        timer = setTimeout(release, 1_000);
        setNotice(`${format} 下载已开始。`);
      }
    } catch (error) {
      release();
      if (!abort.signal.aborted) {
        setError(
          error instanceof Error ? error.message : "导出失败，请刷新后重试。",
        );
        if (
          error instanceof ApiError &&
          [404, 409, 40400001, 40900001].includes(error.code)
        )
          onInvalidated?.();
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="document-export" aria-label="文档导出">
      <div className="form-actions">
        <Button
          disabled={disabled || busy}
          onClick={() => void exportDocument("JSON")}
        >
          下载 JSON
        </Button>
        <Button
          disabled={disabled || busy}
          onClick={() => void exportDocument("HTML")}
        >
          下载 HTML
        </Button>
        <Button
          disabled={disabled || busy}
          onClick={() => void exportDocument("HTML", true)}
        >
          打印 / 另存 PDF
        </Button>
      </div>
      <p className="help-text">
        导出前会核对当前生效版本；PDF 通过浏览器打印保存。
      </p>
      {busy && <p role="status">正在生成导出文件…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <ErrorFeedback error={error} />}
    </div>
  );
}
