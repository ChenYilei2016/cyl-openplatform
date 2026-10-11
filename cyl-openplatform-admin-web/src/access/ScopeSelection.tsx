import { useState } from "react";
import { Button, Checkbox, Input, Table } from "antd";
import type { AdminApi, Application, Scope } from "./api";
import { ErrorFeedback, LoadFeedback } from "@cyl/open-platform-web-shared/components";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { EmptyState, FieldLabel, StatusBadge, StickyActionBar } from "@cyl/open-platform-web-shared/ui/components";

export default function ScopeSelection({
  api,
  application,
  selected,
  onChange,
  onSave,
  onCancel,
  busy,
  error,
  active,
}: {
  api: AdminApi;
  application: Application;
  selected: string[];
  onChange: (codes: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string;
  active: boolean;
}) {
  const [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [expanded, setExpanded] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const list = useReadPage<Scope>(
    api,
    `/scopes?page=${page}&pageSize=20&query=${encodeURIComponent(filter)}`,
    0,
    active,
  );
  const dirty =
    selected.length !== application.scopeCodes.length ||
    selected.some((code) => !application.scopeCodes.includes(code));
  const toggle = (scope: Scope) => {
    if (busy) return;
    if (selected.includes(scope.code)) {
      onChange(selected.filter((code) => code !== scope.code));
      return;
    }
    if (!scope.enabled || selected.length >= 100) return;
    setNames((current) => ({
      ...Object.fromEntries(
        selected.map((code) => [
          code,
          current[code] ?? application.scopeNames?.[code] ?? code,
        ]),
      ),
      [scope.code]: scope.name,
    }));
    onChange([...selected, scope.code]);
  };
  const added = selected.filter((code) => !application.scopeCodes.includes(code)).length;
  const removed = application.scopeCodes.filter((code) => !selected.includes(code)).length;
  return (
    <section className="credential-section" aria-label="应用Scope选择">
      <div className="credential-section__head">
        <h2>调用权限</h2>
        <span className="op-muted">对该凭据的全部关联租户生效</span>
      </div>
      <div className="credential-chips">
        <strong>已选择 {selected.length} / 100 项</strong>
        {(expanded ? selected : selected.slice(0, 8)).map((code) => (
          <Button
            size="small"
            key={code}
            disabled={busy}
            title={code}
            onClick={() => onChange(selected.filter((value) => value !== code))}
            aria-label={`移除权限 ${code}`}
          >
            {names[code] ?? application.scopeNames?.[code] ?? code} ×
          </Button>
        ))}
        {selected.length > 8 && (
          <Button type="link" size="small" onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起已选" : `展开其余 ${selected.length - 8} 项`}
          </Button>
        )}
      </div>
      <form
        className="credential-query"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setFilter(query.trim());
        }}
      >
        <label>
          <FieldLabel label="筛选可选权限组" />
          <Input
            value={query}
            maxLength={100}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="权限组名称或代码"
          />
        </label>
        <Button htmlType="submit" disabled={busy} aria-label="筛选">
          筛选
        </Button>
      </form>
      <LoadFeedback {...list} retry={list.reload} />
      {list.data && (
        <Table<Scope>
          size="small"
          rowKey="id"
          dataSource={list.data.items}
          pagination={{
            current: page,
            pageSize: 20,
            total: list.data.total,
            showSizeChanger: false,
            size: "small",
            disabled: busy,
            showTotal: (total) => `共 ${total} 条`,
            onChange: setPage,
          }}
          locale={{ emptyText: <EmptyState kind={filter ? "noResult" : "empty"} title={filter ? "没有匹配的权限组" : "暂无权限组"} /> }}
          onRow={(scope) => ({
            onClick: (event) => {
              if (!(event.target as HTMLElement).closest("button,input,label")) toggle(scope);
            },
          })}
          columns={[
            {
              title: "选择",
              width: 64,
              render: (_, scope) => (
                <Checkbox
                  aria-label={`${scope.name}（${scope.code}）`}
                  checked={selected.includes(scope.code)}
                  disabled={busy || ((!scope.enabled || selected.length >= 100) && !selected.includes(scope.code))}
                  onChange={() => toggle(scope)}
                />
              ),
            },
            {
              title: "权限组",
              render: (_, scope) => (
                <div className="op-cell-main">
                  <strong>{scope.name}</strong>
                  <span className="op-cell-sub">{scope.code}</span>
                </div>
              ),
            },
            {
              title: "状态",
              width: 140,
              render: (_, scope) =>
                scope.enabled ? (
                  <StatusBadge tone="success">启用</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">停用 · 不可新增</StatusBadge>
                ),
            },
            {
              title: "新凭据默认授予",
              width: 140,
              render: (_, scope) => (scope.defaultForNewApplication ? "是" : "否"),
            },
          ]}
        />
      )}
      <ErrorFeedback error={error} />
      <StickyActionBar
        status={
          <>
            {dirty
              ? `新增 ${added} 项 / 移除 ${removed} 项；全部关联租户的旧Token将失效，需重新签发。`
              : "当前选择已保存"}
            {selected.length >= 100 ? " · 已达100项上限" : ""}
          </>
        }
      >
        <Button disabled={busy || !dirty} onClick={onCancel}>
          撤销选择修改
        </Button>
        <Button type="primary" disabled={busy || list.loading || !dirty} onClick={onSave}>
          保存应用 Scope
        </Button>
      </StickyActionBar>
    </section>
  );
}
