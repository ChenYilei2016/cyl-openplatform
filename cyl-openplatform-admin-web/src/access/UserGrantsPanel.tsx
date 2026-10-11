import { useEffect, useRef, useState } from "react";
import { Button, Input, Table } from "antd";
import CredentialTechnicalDetails from "./CredentialTechnicalDetails";
import { useManagementFilters } from "../navigation/useManagementFilters";
import {
  AdminApiError,
  type AdminApi,
  type TenantGrant,
  type UserGrant,
  type Page,
} from "./api";
import { ErrorFeedback, LoadFeedback } from "@cyl/open-platform-web-shared/components";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import {
  ConfirmAction,
  EmptyState,
  FieldHelp,
  FieldLabel,
  PersonTag,
  StatusBadge,
  TenantTag,
} from "@cyl/open-platform-web-shared/ui/components";
import { delegationStatus } from "./credentialModel";
import EmployeeProfileSearch, {
  type EmployeeProfileOption,
} from "@cyl/open-platform-web-shared/employees/EmployeeProfileSearch";

interface VerifiedEmployee {
  tenantId: string;
  userId: string;
  employeeId: string;
  employeeNo: string;
  displayName: string;
  enabled: boolean;
}
export interface PersonnelEditState {
  dirty: boolean;
  busy: boolean;
}

export default function UserGrantsPanel({
  api,
  grant,
  applicationEnabled,
  onClose,
  onEditState,
}: {
  api: AdminApi;
  grant: TenantGrant;
  applicationEnabled: boolean;
  onClose: () => void;
  onEditState: (state: PersonnelEditState) => void;
}) {
  const { page, filters, setFilters, applied, apply, reset, onPage } =
    useManagementFilters("userDelegations", { employeeNo: "" });
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    inFlight = useRef(false);
  const [employeeNo, setEmployeeNo] = useState(""),
    [employee, setEmployee] = useState<VerifiedEmployee | null>(null);
  const [directory, setDirectory] = useState(false),
    [existing, setExisting] = useState<UserGrant | null>(null);
  const [pendingNumber, setPendingNumber] = useState<string | null>(null);
  const active = applicationEnabled && grant.status === "ACTIVE",
    locked = busy || pendingNumber !== null;
  const dirty = Boolean(employeeNo && !(employee && existing));
  useEffect(() => {
    onEditState({ dirty, busy: locked });
  }, [dirty, locked, onEditState]);
  useEffect(
    () => () => onEditState({ dirty: false, busy: false }),
    [onEditState],
  );
  const base = `/tenant-grants/${encodeURIComponent(grant.id)}`;
  const listPath = `/applications/${encodeURIComponent(grant.applicationId)}${base}/users`;
  const list = useReadPage<UserGrant>(
    api,
    `${listPath}?page=${page}&pageSize=20${applied.employeeNo.trim() ? `&employeeNo=${encodeURIComponent(applied.employeeNo.trim())}` : ""}`,
    revision,
  );
  const readEmployeeGrants = (number: string) =>
    api<Page<UserGrant>>(
      `${listPath}?page=1&pageSize=20&employeeNo=${encodeURIComponent(number)}`,
    );
  function start() {
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
  }
  function finish() {
    inFlight.current = false;
    setBusy(false);
  }
  function showEmployee(number: string) {
    setFilters({ employeeNo: number });
    apply({ employeeNo: number });
    setRevision((value) => value + 1);
  }
  async function lookup(number: string, selected?: EmployeeProfileOption) {
    if (inFlight.current || pendingNumber !== null || !active || !number.trim())
      return;
    start();
    setEmployee(null);
    setExisting(null);
    setEmployeeNo(number);
    setDirectory(false);
    try {
      const [found, grants] = await Promise.all([
        api<VerifiedEmployee>(`${base}/employee-lookup`, {
          method: "POST",
          body: { employeeNo: number.trim() },
        }),
        readEmployeeGrants(number.trim()),
      ]);
      if (
        !found.enabled ||
        found.tenantId !== grant.tenantId ||
        !found.employeeId ||
        !found.userId ||
        (selected &&
          (selected.tenantId !== found.tenantId ||
            selected.employeeId !== found.employeeId))
      )
        throw new Error("该工号对应的人员已变化或不可委托，请重新核验。");
      setEmployee(found);
      setExisting(
        grants.items.find(
          (item) =>
            item.status === "ACTIVE" || item.employeeId !== found.employeeId,
        ) ?? null,
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      finish();
    }
  }
  async function mutate(action: "grant" | "revoke", revoking?: UserGrant) {
    if (inFlight.current || pendingNumber !== null) return;
    const target = action === "grant" ? employee : revoking;
    if (!target || (action === "grant" && (!active || existing))) return;
    start();
    try {
      if (action === "grant")
        await api<UserGrant>(`${base}/users`, {
          method: "POST",
          body: {
            employeeNo: target.employeeNo,
            expectedUserId: target.userId,
            expectedEmployeeId: target.employeeId,
          },
        });
      else if (revoking)
        await api(
          `/user-grants/${encodeURIComponent(revoking.id)}?expectedVersion=${revoking.authorizationVersion}`,
          { method: "DELETE" },
        );
      if (action === "grant") {
        setEmployee(null);
        setEmployeeNo("");
        setExisting(null);
      } else if (employee?.employeeNo === target.employeeNo) {
        setEmployee(null);
        setExisting(null);
      }
      showEmployee(target.employeeNo);
      setMessage(
        action === "grant"
          ? `${target.displayName}（${target.employeeNo}）的委托已建立。`
          : `${target.displayName}（${target.employeeNo}）的委托已撤销。`,
      );
    } catch (failure) {
      setError((failure as Error).message);
      const status =
        failure instanceof AdminApiError
          ? (failure.httpStatus ??
            (failure.code < 1000
              ? failure.code
              : Math.floor(failure.code / 100000)))
          : 0;
      // 仅4xx能确认写入被拒绝；超时、损坏响应及5xx均先读取真实状态再继续。
      if (status < 400 || status >= 500) setPendingNumber(target.employeeNo);
      if (action === "grant") {
        setEmployee(null);
        setExisting(null);
      }
    } finally {
      finish();
    }
  }
  async function reconcile() {
    if (inFlight.current || pendingNumber === null) return;
    start();
    try {
      const grants = await readEmployeeGrants(pendingNumber);
      const current = grants.items.find((item) => item.status === "ACTIVE");
      showEmployee(pendingNumber);
      setPendingNumber(null);
      setMessage(
        current
          ? `已核对工号 ${pendingNumber}：当前委托有效。`
          : `已核对工号 ${pendingNumber}：当前无有效委托。`,
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      finish();
    }
  }
  return (
    <section className="credential-section" aria-label={`租户 ${grant.tenantId} 人员委托`}>
      <div className="credential-section__head">
        <Button disabled={locked} onClick={onClose}>
          返回租户关联
        </Button>
        <h2>租户 {grant.tenantName || grant.tenantId} · 人员委托</h2>
        <StatusBadge tone={grant.status === "ACTIVE" ? "success" : "neutral"}>
          {grant.status === "ACTIVE" ? "有效关联" : "已解绑"}
        </StatusBadge>
        <FieldHelp label="人员委托">
          委托后，此凭据可申请代表员工调用的人员 Token，不增加接口权限。姓名目录仅提供线索；每次提交都会重新核验本地账号身份。已有租户 Token 不会自动切换身份。
        </FieldHelp>
      </div>
      {(grant.tenantName || grant.note) && (
        <p className="credential-section__context">
          {grant.tenantName && (
            <span>
              租户：<TenantTag id={grant.tenantId} name={grant.tenantName} />
            </span>
          )}
          {grant.note && <span>本租户备注：{grant.note}</span>}
        </p>
      )}
      {!active && (
        <p role="status" className="credential-pending">
          {!applicationEnabled ? "凭据已停用" : "租户关联已解绑"}
          ：可以查看和撤销已有委托，恢复后才能新增。
        </p>
      )}
      <ErrorFeedback error={error} />
      {pendingNumber !== null && (
        <div className="credential-pending" role="status">
          工号 {pendingNumber} 的操作结果未确认，暂不能继续写入或离开。
          <Button size="small" loading={busy} onClick={() => void reconcile()}>
            核对最新委托
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="credential-notice">
          {message}
        </p>
      )}
      {active && (
        <section aria-label="建立人员委托" className="credential-section">
          <form
            className="credential-query"
            onSubmit={(event) => {
              event.preventDefault();
              void lookup(employeeNo);
            }}
          >
            <label>
              <FieldLabel label="委托员工号" />
              <Input
                aria-label="委托员工号"
                placeholder="输入完整工号，先核验身份"
                value={employeeNo}
                maxLength={64}
                disabled={locked}
                onChange={(event) => {
                  setEmployeeNo(event.target.value);
                  setEmployee(null);
                  setExisting(null);
                  setError("");
                  setMessage("");
                }}
              />
            </label>
            <Button
              type={employee ? "default" : "primary"}
              htmlType="submit"
              loading={busy}
              disabled={locked || !employeeNo.trim()}
            >
              核验员工
            </Button>
            <Button disabled={locked} onClick={() => setDirectory((value) => !value)}>
              {directory ? "收起姓名选择" : "按姓名选择"}
            </Button>
            {employeeNo && (
              <Button
                type="text"
                disabled={locked}
                onClick={() => {
                  setEmployeeNo("");
                  setEmployee(null);
                  setExisting(null);
                  setError("");
                }}
              >
                清空员工
              </Button>
            )}
          </form>
          {directory && (
            <div className="credential-directory">
              <EmployeeProfileSearch
                api={api}
                path={`/employee-profiles?tenantId=${encodeURIComponent(grant.tenantId)}`}
                tenantLabel={grant.tenantName || `租户 ${grant.tenantId}`}
                onUseEmployeeNumber={() => setDirectory(false)}
                onSelect={(profile) => void lookup(profile.employeeNo, profile)}
              />
            </div>
          )}
          {employee && (
            <div className="credential-verified" role="status">
              <div>
                <span>
                  <StatusBadge tone="success">已核验</StatusBadge>{" "}
                  <strong>{employee.displayName}</strong> · 工号 {employee.employeeNo}
                </span>
                {existing && (
                  <span className="credential-verified__existing">
                    {existing.employeeId !== employee.employeeId
                      ? "历史委托属于另一人员，请核对人员工号与历史委托；重新核验不会自动转移授权。"
                      : existing.userId === employee.userId
                        ? "已有有效委托，无需重复建立。"
                        : "既有委托的账号已变化，请先撤销旧委托，再核验建立。"}
                  </span>
                )}
              </div>
              {existing ? (
                <Button onClick={() => showEmployee(employee.employeeNo)} disabled={locked}>
                  查看已有委托
                </Button>
              ) : (
                <Button type="primary" disabled={locked} onClick={() => void mutate("grant")}>
                  确认建立委托
                </Button>
              )}
            </div>
          )}
        </section>
      )}
      <div className="credential-section__head">
        <h3>已有人员委托{list.data ? `（${list.data.total}）` : ""}</h3>
        <div className="credential-section__actions">
          <Button disabled={locked || list.loading} onClick={list.reload}>
            刷新委托
          </Button>
        </div>
      </div>
      <form
        className="credential-query"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label>
          <FieldLabel label="已有委托工号（精确）" />
          <Input
            aria-label="已有委托工号（精确）"
            placeholder="筛选已有委托"
            maxLength={64}
            value={filters.employeeNo}
            disabled={locked}
            onChange={(event) => setFilters({ employeeNo: event.target.value })}
          />
        </label>
        <Button htmlType="submit" disabled={locked}>
          搜索已有委托
        </Button>
        <Button disabled={locked} onClick={reset}>
          重置
        </Button>
      </form>
      <LoadFeedback {...list} retry={list.reload} />
      {list.data && (
        <Table<UserGrant>
          rowKey="id"
          size="small"
          dataSource={list.data.items}
          pagination={{
            current: page,
            pageSize: 20,
            total: list.data.total,
            showSizeChanger: false,
            size: "small",
            disabled: locked || list.loading,
            showTotal: (total) => `共 ${total} 条`,
            onChange: onPage,
          }}
          locale={{
            emptyText: applied.employeeNo ? (
              <EmptyState kind="noResult" title="未找到该工号的委托" description="可重置筛选查看全部。" />
            ) : (
              <EmptyState title="暂无人员委托" description="可输入工号或按姓名选择，核验后建立。" />
            ),
          }}
          columns={[
            {
              title: "人员",
              render: (_, user) => (
                <PersonTag name={user.displayName} employeeNo={user.employeeNo} id={user.employeeId} stacked />
              ),
            },
            {
              title: "委托状态",
              width: 110,
              render: (_, user) => <delegationStatus.Badge value={user.status} />,
            },
            {
              title: "人员标识",
              width: 110,
              render: (_, user) => (
                <CredentialTechnicalDetails
                  records={[
                    ["人员编号", user.employeeId],
                    ["用户编号", user.userId],
                    ["委托编号", user.id],
                  ]}
                />
              ),
            },
            {
              title: "操作",
              width: 100,
              render: (_, user) => (
                <ConfirmAction
                  title="撤销人员委托？"
                  description={`撤销 ${user.displayName}（${user.employeeNo}）后，该人员旧 Token 后续调用会被拒绝；其他人员、租户和租户级调用不受影响。`}
                  okText="确认撤销"
                  danger
                  disabled={locked || user.status !== "ACTIVE"}
                  onConfirm={() => {
                    setError("");
                    setMessage("");
                    return mutate("revoke", user);
                  }}
                >
                  <Button type="link" danger size="small" disabled={locked || user.status !== "ACTIVE"}>
                    撤销<span className="sr-only"> {user.employeeNo}</span>
                  </Button>
                </ConfirmAction>
              ),
            },
          ]}
        />
      )}
    </section>
  );
}
