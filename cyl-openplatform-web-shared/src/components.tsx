import { Alert, Button } from "antd";
import { useEffect, useState } from 'react';
import type { ApiClient, Page } from './http';
import './styles/feedback.css';

export function usePage<T>(api: ApiClient, path: string, revision = 0) {
  const [data, setData] = useState<Page<T> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    void api<Page<T>>(path, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '加载失败');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [api, path, revision, retry]);
  return { data, error, loading, reload: () => setRetry(value => value + 1) };
}

export function Pagination({ page, total, onChange, label, disabled = false }: { page: number; total: number; onChange: (page: number) => void; label: string; disabled?: boolean }) {
  return <nav className="op-pagination" aria-label={label}>
    <span>共 {total} 条 · 第 {page} 页</span>
    <Button size="small" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>上一页</Button>
    <Button size="small" disabled={disabled || page * 20 >= total} onClick={() => onChange(page + 1)}>下一页</Button>
  </nav>;
}

/** 关闭只收起提示，不清除业务阻断；新错误或重试后的错误会重新显示。 */
export function ErrorFeedback({ error }: { error: string }) {
  if (!error) return null;
  return <Alert key={error} type="error" className="error-note compact-feedback" closable={{'aria-label':'关闭错误提示'}}
    title={error.length > 160 || error.includes('\n') ? <details><summary>操作未完成 · 展开错误详情</summary><div className="feedback-detail">{error}</div></details> : error}/>;
}

export function LoadFeedback({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  return <>{loading && <p role="status" className="op-load-status">正在加载…</p>}{error && <div className="load-feedback"><ErrorFeedback error={loading ? "" : error} /><Button size="small" onClick={retry}>重新加载</Button></div>}</>;
}
