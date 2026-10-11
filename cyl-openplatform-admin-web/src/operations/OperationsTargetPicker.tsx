import { useState } from "react";
import { Button, Input, Popover, Table, Tooltip } from "antd";
import {
  LoadFeedback,
  Pagination,
} from "@cyl/open-platform-web-shared/components";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import type { AdminApi } from "../access/api";
interface Target {
  id: string;
  name: string;
  description: string;
}
export default function OperationsTargetPicker({
  api,
  kind,
  value,
  tenantId = "",
  onChange,
}: {
  api: AdminApi;
  kind: "API" | "APPLICATION" | "TENANT" | "EMPLOYEE";
  tenantId?: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [input, setInput] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const base = `/operations/targets?kind=${kind}${tenantId ? "&tenantId="+encodeURIComponent(tenantId) : ""}`;
  const selected = useReadPage<Target>(
    api,
    base + `&id=${encodeURIComponent(value)}&page=1&pageSize=1`,
    0,
    Boolean(value),
  );
  const byId =
    /^(?:[A-Z]{3}_[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(
      query,
    );
  const list = useReadPage<Target>(
    api,
    base +
      `&page=${page}&pageSize=20&${byId ? "id" : "query"}=${encodeURIComponent(query)}`,
    0,
    open,
  );
  const label = selected.data?.items[0]?.name || (value || {API:"全部 API",APPLICATION:"全部接入凭据",TENANT:"全部租户",EMPLOYEE:tenantId ? "全部调用人员" : "先选租户"}[kind]);
  return (
    <div className="op-target">
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={open}
        onOpenChange={setOpen}
        content={
          <section
            className="op-target__picker"
            aria-label={{API:"选择统计API",APPLICATION:"选择统计凭据",TENANT:"选择统计租户",EMPLOYEE:"选择调用人员"}[kind]}
          >
            <Input.Search
              aria-label="搜索统计对象"
              placeholder="按名称搜索，或粘贴完整 ID"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onSearch={() => {
                setQuery(input.trim());
                setPage(1);
              }}
              enterButton="搜索"
            />
            <LoadFeedback {...list} retry={list.reload} />
            <Table<Target>
              size="small"
              rowKey="id"
              pagination={false}
              scroll={{ y: 250 }}
              dataSource={list.data?.items ?? []}
              columns={[
                {
                  title: "名称 / 标识",
                  render: (_, t) => (
                    <>
                      <strong>{t.name}</strong>
                      <small>{t.description}</small>
                    </>
                  ),
                },
                {
                  title: "选择",
                  width: 72,
                  render: (_, t) => (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        onChange(t.id);
                        setOpen(false);
                      }}
                    >
                      选择
                    </Button>
                  ),
                },
              ]}
            />
            {list.data && (
              <Pagination
                page={page}
                total={list.data.total}
                onChange={setPage}
                label="统计对象分页"
              />
            )}
          </section>
        }
      >
        <Tooltip title={kind === "EMPLOYEE" && !tenantId ? "请先选择租户" : label}>
          <Button className="op-target__trigger" disabled={kind === "EMPLOYEE" && !tenantId}>
            <span>{label}</span>
          </Button>
        </Tooltip>
      </Popover>
      {value && (
        <Button
          type="text"
          aria-label={{API:"清除统计API",APPLICATION:"清除统计凭据",TENANT:"清除统计租户",EMPLOYEE:"清除调用人员"}[kind]}
          onClick={() => onChange("")}
        >
          ×
        </Button>
      )}
      {selected.error && (
        <span className="op-target__warning">
          名称读取失败，仍按 ID 筛选
          <Button type="link" size="small" onClick={selected.reload}>
            重读
          </Button>
        </span>
      )}
    </div>
  );
}
