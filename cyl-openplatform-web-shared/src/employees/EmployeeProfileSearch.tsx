import { useRef, useState } from "react";
import { Button, Input } from "antd";
import type { ApiClient } from "../http";
import { LoadFeedback, Pagination, usePage } from "../components";
import { FieldHelp, IdText } from "../ui/components";
import "./employees.css";

export interface EmployeeProfileOption {
  id?: string;
  tenantId: string;
  tenantName?: string | null;
  employeeId: string;
  employeeNo: string;
  displayName: string;
  lastSeenAt: string;
}

/** 两端共用展示目录；选择只提供线索，授权仍须重新核验本地账号身份。 */
export default function EmployeeProfileSearch({
  api,
  path,
  tenantLabel,
  selectionLabel = '选择并核验',
  onSelect,
  onUseEmployeeNumber,
}: {
  api: ApiClient;
  path: string;
  tenantLabel: string;
  selectionLabel?: string;
  onSelect?: (profile: EmployeeProfileOption) => void;
  onUseEmployeeNumber?: () => void;
}) {
  const [filters, setFilters] = useState({ name: "", employeeNo: "" });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (applied.name) query.set("name", applied.name);
  if (applied.employeeNo) query.set("employeeNo", applied.employeeNo);
  const list = usePage<EmployeeProfileOption>(
    api,
    `${path}${path.includes("?") ? "&" : "?"}${query}`,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section
      className="employee-directory"
      aria-label="已登记人员目录"
      aria-busy={list.loading}
    >
      <p className="employee-directory-context">
        {tenantLabel} · 仅查询已在平台登记的人员
        <FieldHelp label="目录范围">目录仅包含已登记人员的展示资料；姓名不代表当前任职状态或授权。</FieldHelp>
      </p>
      <form
        className="employee-directory-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({
            name: filters.name.trim(),
            employeeNo: filters.employeeNo.trim(),
          });
          setPage(1);
        }}
      >
        <label>
          姓名（包含）
          <Input
            autoFocus
            maxLength={100}
            value={filters.name}
            placeholder="输入姓名"
            onChange={(event) =>
              setFilters({ ...filters, name: event.target.value })
            }
          />
        </label>
        <label>
          工号（精确）
          <Input
            maxLength={64}
            value={filters.employeeNo}
            placeholder="输入完整工号"
            onChange={(event) =>
              setFilters({ ...filters, employeeNo: event.target.value })
            }
          />
        </label>
        <Button htmlType="submit" type="primary" disabled={list.loading}>
          查询人员
        </Button>
        <Button
          type="default"
          onClick={() => {
            const empty = { name: "", employeeNo: "" };
            setFilters(empty);
            setApplied(empty);
            setPage(1);
          }}
        >
          重置
        </Button>
      </form>
      <LoadFeedback {...list} retry={list.reload} />
      {(list.error || list.data?.items.length === 0) && (
        <div className="employee-directory-empty">
          {!list.error && <p>未找到已登记人员，这不代表账号目录中不存在此人。</p>}
          {onUseEmployeeNumber && (
            <Button type="default" onClick={onUseEmployeeNumber}>
              改用工号核验
            </Button>
          )}
        </div>
      )}
      <h3 ref={heading} tabIndex={-1} className="sr-only">
        已登记人员结果
      </h3>
      {list.data && list.data.items.length > 0 && (
        <>
          <ul className="employee-directory-results">
            {list.data.items.map((profile) => (
              <li key={profile.employeeId}>
                <div className="employee-directory-person">
                  <strong>{profile.displayName}</strong>
                  <span>
                    工号 {profile.employeeNo} ·{" "}
                    {profile.tenantName || `租户 ${profile.tenantId}`}
                  </span>
                  <IdText value={profile.employeeId} label="人员编号" />
                </div>
                <div className="employee-directory-seen">
                  <small>最近登记</small>
                  <time dateTime={profile.lastSeenAt}>
                    {new Date(profile.lastSeenAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </time>
                </div>
                {onSelect && (
                  <Button
                    type="default"
                    aria-label={`选择 ${profile.displayName} · ${profile.employeeNo}`}
                    onClick={() => onSelect(profile)}
                  >
                    {selectionLabel}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            total={list.data.total}
            label="已登记人员分页"
            disabled={list.loading}
            onChange={(next) => {
              setPage(next);
              heading.current?.focus();
            }}
          />
        </>
      )}
    </section>
  );
}
