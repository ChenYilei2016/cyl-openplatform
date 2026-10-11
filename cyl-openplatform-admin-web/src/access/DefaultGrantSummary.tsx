import { SafetyCertificateOutlined } from "@ant-design/icons";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Tooltip } from "antd";
import type { AdminApi, Scope } from "./api";

/** 默认授予组通常只有几个；一次读取上限 100，超出时提示用筛选查看全部。 */
const LIMIT = 100;

/**
 * 新凭据会获得哪些权限组：列出标记了“新凭据默认授予”的组。只有已启用的会在创建凭据时复制，
 * 停用的单独提示“不会授予”；更改默认标记不影响已有凭据。
 */
export default function DefaultGrantSummary({ api, revision, onOpen, onFilter }: { api: AdminApi; revision: number; onOpen: (scopeId: string) => void; onFilter: () => void }) {
  const defaults = useReadPage<Scope>(api, `/scopes?page=1&pageSize=${LIMIT}&defaultForNewApplication=true`, revision, true, { keepPrevious: true });
  const items = (defaults.data?.items ?? []).filter((scope) => scope.defaultForNewApplication);
  const granted = items.filter((scope) => scope.enabled);
  const skipped = items.filter((scope) => !scope.enabled);
  if (defaults.error) return null;
  return (
    <section className="scope-defaults" aria-label="新建凭据时默认授予的权限组">
      <div className="scope-defaults__head">
        <SafetyCertificateOutlined className="scope-defaults__icon" aria-hidden />
        <strong>新建凭据时默认授予</strong>
        <span className="scope-defaults__count">{defaults.data ? `${granted.length} 个权限组` : "读取中…"}</span>
        <span className="scope-defaults__hint">只在创建新凭据时复制；更改默认标记不会给已有凭据补授或回收权限。</span>
        {items.length > 0 && (
          <Button type="link" size="small" className="scope-defaults__filter" onClick={onFilter}>
            只看这些
          </Button>
        )}
      </div>
      {defaults.data && (
        <div className="scope-defaults__chips">
          {granted.length === 0 && <span className="scope-defaults__empty">暂无：新建的凭据不会自动获得任何权限组，需要在新建时手动选择。</span>}
          {granted.map((scope) => (
            <Tooltip key={scope.id} title={<span className="op-code">{scope.code}</span>}>
              <button type="button" className="scope-defaults__chip" onClick={() => onOpen(scope.id)}>
                {scope.name}
              </button>
            </Tooltip>
          ))}
          {skipped.length > 0 && (
            <span className="scope-defaults__skipped">
              已停用、不会授予：
              {skipped.map((scope, index) => (
                <span key={scope.id}>
                  {index > 0 && "、"}
                  <button type="button" className="scope-defaults__link" onClick={() => onOpen(scope.id)}>
                    {scope.name}
                  </button>
                </span>
              ))}
            </span>
          )}
          {(defaults.data.total ?? 0) > LIMIT && <span className="scope-defaults__empty">另有更多，点“只看这些”查看全部。</span>}
        </div>
      )}
    </section>
  );
}
