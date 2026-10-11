import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Input, Select, Switch, Tooltip } from "antd";
import EmployeeProfileSearch, {
  type EmployeeProfileOption,
} from "@cyl/open-platform-web-shared/employees/EmployeeProfileSearch";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { ConfirmAction, FieldHelp, FieldLabel, IdText, StatusBadge, TenantTag } from "@cyl/open-platform-web-shared/ui/components";
import { AdminApiError, type AdminApi, type Page } from "../access/api";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import {
  permissionNames,
  employeeStatusNames,
  type Administrator,
  type EmployeeIdentity,
} from "./types";
import { lastSuperReason, type AdministratorStatus } from "./administratorModel";

const templates: Record<string, string[]> = {
  研发模板: ["MANAGE_APIS", "PUBLISH_APIS"],
  审核模板: ["REVIEW_APIS"],
  运维模板: ["MANAGE_OPERATIONS", "MANAGE_CONNECTIONS", "VIEW_AUDIT"],
  审计模板: ["VIEW_AUDIT"],
};
const permissionDescriptions: Record<string, string> = {
  MANAGE_APPLICATIONS: "凭据、租户与人员授权",
  MANAGE_APIS: "接口配置、测试及文档",
  PUBLISH_APIS: "提交接口版本发布",
  REVIEW_APIS: "审核他人提交的发布",
  VIEW_AUDIT: "查看审计与授权记录",
  MANAGE_OPERATIONS: "配额、治理和运行监控",
  MANAGE_CONNECTIONS: "维护注册中心与服务连接",
};
const samePermissions = (left: string[], right: string[]) =>
  left.length === right.length && left.every((code) => right.includes(code));
const errorStatus = (failure: unknown) =>
  failure instanceof AdminApiError
    ? (failure.httpStatus ??
      (failure.code < 1000 ? failure.code : Math.floor(failure.code / 100000)))
    : 0;

export default function AdministratorEditor({
  api,
  initialTenantId,
  administrator,
  revoking,
  canManage,
  status,
  onClose,
  onSaved,
}: {
  api: AdminApi;
  initialTenantId: string;
  administrator: Administrator | null;
  revoking: boolean;
  canManage: boolean;
  status: AdministratorStatus | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const navigation = useAdminNavigation();
  const [baseline, setBaseline] = useState(administrator),
    [latestStatus, setLatestStatus] = useState(status);
  const [tenantId, setTenantId] = useState(initialTenantId),
    [employeeNo, setEmployeeNo] = useState("");
  const [employee, setEmployee] = useState<EmployeeIdentity | null>(null),
    [existing, setExisting] = useState<Administrator | null>(null);
  const [directory, setDirectory] = useState(false),
    [hasVerified, setHasVerified] = useState(false);
  const [permissions, setPermissions] = useState(
    administrator?.permissions ?? [],
  );
  const [superAdministrator, setSuperAdministrator] = useState(
    administrator?.superAdministrator ?? false,
  );
  const [enabled, setEnabled] = useState(
      revoking ? false : (administrator?.enabled ?? true),
    ),
    [reason, setReason] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false),
    [unknown, setUnknown] = useState(false),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false),
    releaseGuard = useRef<(() => void) | undefined>(undefined);
  const locked = busy || unknown || !canManage;
  const dirty = Boolean(
    reason ||
      (!administrator &&
        ((employeeNo && !existing) ||
          tenantId !== initialTenantId ||
          permissions.length ||
          superAdministrator)) ||
      (administrator &&
        (enabled !== administrator.enabled ||
          superAdministrator !== administrator.superAdministrator ||
          !samePermissions(permissions, administrator.permissions))),
  );
  const lastSuper = Boolean(
    baseline?.enabled &&
      baseline.superAdministrator &&
      latestStatus?.enabledSuperAdministratorCount === 1,
  );
  const removesSuper = Boolean(
    baseline?.enabled &&
      baseline.superAdministrator &&
      (!enabled || !superAdministrator),
  );
  const missing = !canManage
    ? "当前已无分配权限，已保留输入。"
    : existing
      ? "此员工已有管理员记录，请调整原记录。"
      : !baseline && !employee
        ? "先核验有效员工，再分配权限。"
        : removesSuper && !latestStatus
          ? "先重新检查总管理员数量，才能停用或降级。"
          : removesSuper && lastSuper
            ? lastSuperReason
            : !reason.trim()
              ? "请填写调整原因。"
              : "";
  useEffect(() => {
    setLatestStatus(status);
  }, [status]);
  useEffect(() => {
    const release = navigation.registerDraft({
      administratorId: administrator?.id ?? "new",
      administratorView: navigation.route.administratorView,
      dirty: () => dirty || unknown || inFlight.current,
      busy: () => inFlight.current,
      canSave: false,
      leaveMessage: unknown
        ? "本次授权结果未确认，请先核对最新记录；离开不会撤回已提交的变更。"
        : "管理员调整尚未提交，离开将放弃本次输入。",
      save: async () => false,
    });
    releaseGuard.current = release;
    return release;
  }, [
    navigation.registerDraft,
    navigation.route.administratorView,
    administrator?.id,
    dirty,
    unknown,
    busy,
  ]);
  function start() {
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
  }
  function finish() {
    inFlight.current = false;
    setBusy(false);
  }
  function clearIdentity() {
    setEmployee(null);
    setExisting(null);
    setError("");
    setConflict(false);
  }
  async function lookup(number = employeeNo, selected?: EmployeeProfileOption) {
    if (
      inFlight.current ||
      unknown ||
      !canManage ||
      !tenantId.trim() ||
      !number.trim()
    )
      return;
    start();
    clearIdentity();
    setDirectory(false);
    setEmployeeNo(number);
    try {
      const identity = await api<EmployeeIdentity>(
        "/administrators/employee-lookup",
        {
          method: "POST",
          body: { tenantId: tenantId.trim(), employeeNo: number.trim() },
        },
      );
      if (
        !identity.enabled ||
        identity.tenantId !== tenantId.trim() ||
        identity.employeeNo !== number.trim() ||
        !identity.employeeId ||
        !identity.userId ||
        (selected &&
          (identity.employeeId !== selected.employeeId ||
            identity.tenantId !== selected.tenantId))
      )
        throw new Error(
          "该工号对应的人员已变化。请改用工号核验，核对当前姓名后再分配权限。",
        );
      const records = await api<Page<Administrator>>(
        `/administrators?tenantId=${encodeURIComponent(identity.tenantId)}&employeeNo=${encodeURIComponent(identity.employeeNo)}&page=1&pageSize=20`,
      );
      setEmployee(identity);
      setHasVerified(true);
      setExisting(records.items[0] ?? null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      finish();
    }
  }
  async function refreshLatest() {
    if (inFlight.current) return;
    start();
    try {
      const [latest, count] = await Promise.all([
        baseline
          ? api<Administrator>(
              `/administrators/${encodeURIComponent(baseline.id)}`,
            )
          : api<Page<Administrator>>(
              `/administrators?tenantId=${encodeURIComponent(tenantId.trim())}&employeeNo=${encodeURIComponent(employeeNo.trim())}&page=1&pageSize=20`,
            ).then((result) => result.items[0] ?? null),
        api<AdministratorStatus>("/administrators/status"),
      ]);
      setLatestStatus(count);
      setUnknown(false);
      setConflict(false);
      if (baseline && latest) setBaseline(latest);
      else if (latest) setExisting(latest);
      setNotice(
        latest
          ? `已读取最新记录（修订 ${latest.revision}），本次输入保留。请核对下方变化再确认。`
          : "已核对：暂无此员工的管理员记录，请重新核验后决定是否提交。",
      );
      if (!baseline) setEmployee(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      finish();
    }
  }
  async function save() {
    if (inFlight.current || unknown || conflict || missing) return;
    start();
    try {
      await api<Administrator>(
        baseline
          ? `/administrators/${encodeURIComponent(baseline.id)}`
          : "/administrators",
        {
          method: baseline ? "PUT" : "POST",
          body: baseline
            ? {
                expectedRevision: baseline.revision,
                permissions,
                enabled,
                superAdministrator,
                reason: reason.trim(),
              }
            : {
                tenantId: employee!.tenantId,
                employeeNo: employee!.employeeNo,
                expectedUserId: employee!.userId,
                expectedEmployeeId: employee!.employeeId,
                permissions,
                superAdministrator,
                reason: reason.trim(),
              },
        },
      );
      releaseGuard.current?.();
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
      const status = errorStatus(failure);
      setUnknown(status < 400 || status >= 500);
      setConflict(status === 409);
      if (!baseline) setEmployee(null);
    } finally {
      finish();
    }
  }
  const selectionVisible = Boolean(baseline || employee || hasVerified);
  const changes = baseline
    ? [
        enabled !== baseline.enabled
          ? `${baseline.enabled ? "启用" : "停用"} → ${enabled ? "启用" : "停用"}`
          : "",
        superAdministrator !== baseline.superAdministrator
          ? `${baseline.superAdministrator ? "总管理员" : "普通管理员"} → ${superAdministrator ? "总管理员" : "普通管理员"}`
          : "",
        ...permissions
          .filter((code) => !baseline.permissions.includes(code))
          .map((code) => `增加 ${permissionNames[code] ?? code}`),
        ...baseline.permissions
          .filter((code) => !permissions.includes(code))
          .map((code) => `移除 ${permissionNames[code] ?? code}`),
      ].filter(Boolean)
    : [];
  // 撤销与降级先说明后果再提交；其余调整直接提交。
  const revokes = Boolean(baseline?.enabled && !enabled);
  const demotes = Boolean(baseline?.superAdministrator && baseline.enabled && enabled && !superAdministrator);
  const submitDisabled = locked || conflict || Boolean(missing);
  const submitButton = (
    <Button
      type="primary"
      danger={Boolean(baseline && !enabled)}
      htmlType={revokes || demotes ? "button" : "submit"}
      form="administrator-editor"
      loading={busy}
      disabled={submitDisabled}
    >
      {revokes ? "确认撤销" : baseline ? "确认调整" : "确认分配"}
    </Button>
  );
  // 最后一名总管理员：只禁止转入不安全状态，已处于停用/降级输入时仍可改回。
  const protectedControl = (control: ReactNode, safe: boolean) =>
    lastSuper && safe ? (
      <Tooltip title={lastSuperReason}>
        <span className="administrator-protected">{control}</span>
      </Tooltip>
    ) : (
      control
    );
  return (
    <div className="administrator-editor">
      <ErrorFeedback error={error} />
      {(conflict || unknown) && (
        <div className="administrator-callout administrator-callout--warning" role="status">
          <span>
            {unknown
              ? "操作结果未确认，暂不能再次提交。"
              : "记录或人员身份已变化，本次输入已保留。"}
          </span>
          <Button
            disabled={busy || !canManage}
            onClick={() => void refreshLatest()}
          >
            {unknown ? "核对最新授权状态" : "读取最新记录并保留输入"}
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="administrator-callout">
          {notice}
        </p>
      )}
      <section aria-label="目标员工" className="administrator-section">
        <h3>{baseline ? "人员" : "1. 选择并核验员工"}</h3>
        {baseline ? (
          <dl className="administrator-facts">
            <div><dt>工号</dt><dd>{baseline.employeeNo}</dd></div>
            <div><dt>租户</dt><dd><TenantTag id={baseline.tenantId} name={baseline.tenantName} /></dd></div>
            <div><dt>资格</dt><dd><StatusBadge tone={baseline.enabled ? "success" : "neutral"}>{baseline.enabled ? "资格启用" : "资格停用"}</StatusBadge></dd></div>
            <div><dt>当前修订</dt><dd>{baseline.revision}</dd></div>
            <div><dt>用户编号</dt><dd><IdText value={baseline.userId} label="用户编号" maxChars={20} /></dd></div>
            <div><dt>员工编号</dt><dd><IdText value={baseline.employeeId} label="员工编号" maxChars={20} /></dd></div>
          </dl>
        ) : (
          <>
            <form
              className="administrator-lookup"
              onSubmit={(event) => {
                event.preventDefault();
                void lookup();
              }}
            >
              <label>
                <FieldLabel label="员工租户 ID" required help="姓名目录与工号核验都只在该租户内查询。" />
                <Input
                  aria-label="员工租户 ID"
                  required
                  maxLength={64}
                  value={tenantId}
                  disabled={locked}
                  onChange={(event) => {
                    setTenantId(event.target.value);
                    clearIdentity();
                    setDirectory(false);
                  }}
                />
              </label>
              <label>
                <FieldLabel label="员工工号" />
                <Input
                  aria-label="员工工号"
                  maxLength={64}
                  value={employeeNo}
                  disabled={locked}
                  onChange={(event) => {
                    setEmployeeNo(event.target.value);
                    clearIdentity();
                  }}
                />
              </label>
              <div className="administrator-lookup__actions">
                <Button
                  type={employee ? "default" : "primary"}
                  disabled={locked || !tenantId.trim() || !employeeNo.trim()}
                  htmlType="submit"
                >
                  核验员工
                </Button>
                <Button
                  disabled={locked || !tenantId.trim()}
                  onClick={() => setDirectory((value) => !value)}
                >
                  {directory ? "收起姓名选择" : "按姓名选择"}
                </Button>
              </div>
            </form>
            {!tenantId.trim() && (
              <p className="administrator-hint">
                先填写目标员工租户；姓名目录仅在该租户内查询。
              </p>
            )}
            {directory && (
              <EmployeeProfileSearch
                api={api}
                path={`/administrators/employee-profiles?tenantId=${encodeURIComponent(tenantId.trim())}`}
                tenantLabel={`租户 ${tenantId.trim()}`}
                onUseEmployeeNumber={() => setDirectory(false)}
                onSelect={(profile) => void lookup(profile.employeeNo, profile)}
              />
            )}
            {employee && (
              <div className="administrator-callout administrator-callout--success" role="status">
                <strong>已核验员工：{employee.displayName}</strong>
                <span>
                  工号 {employee.employeeNo} ·{" "}
                  {employeeStatusNames[employee.employeeStatus] ?? "有效员工"}
                </span>
              </div>
            )}
            {existing && (
              <div className="administrator-callout administrator-callout--warning">
                此员工已有{existing.enabled ? "启用" : "停用"}的管理员记录。
                <Button
                  onClick={() =>
                    navigation.navigate({
                      ...navigation.route,
                      administratorId: existing.id,
                      administratorView: "edit",
                    })
                  }
                >
                  调整已有管理员
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      <form
        id="administrator-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {selectionVisible && !existing && (
          <section aria-label="管理员类型与业务权限" className="administrator-section">
            <h3>
              {baseline ? "管理资格与业务能力" : "2. 分配管理资格与业务能力"}
              <FieldHelp label="权限">
                总管理员可以分配、调整和撤销后台管理资格。七项业务能力分别授予，总管理员不会隐式获得未勾选能力；管理员资格不影响门户本租户自助资格。
              </FieldHelp>
            </h3>
            <fieldset disabled={locked} className="administrator-fields">
              <div className="administrator-switches">
                <div className="administrator-switch">
                  {protectedControl(
                    <Switch
                      aria-label="总管理员（可分配或撤销权限）"
                      disabled={locked || (lastSuper && superAdministrator)}
                      checked={superAdministrator}
                      onChange={setSuperAdministrator}
                    />,
                    superAdministrator,
                  )}
                  <div>
                    <strong>总管理员</strong>
                    <p>可分配、调整或撤销其他人的管理资格；与业务能力独立授予，开启不会自动全选业务能力。</p>
                  </div>
                </div>
                {baseline && (
                  <div className="administrator-switch">
                    {protectedControl(
                      <Switch
                        aria-label="启用管理资格（取消即停用）"
                        disabled={locked || (lastSuper && enabled)}
                        checked={enabled}
                        onChange={setEnabled}
                      />,
                      enabled,
                    )}
                    <div>
                      <strong>启用管理资格</strong>
                      <p>关闭即停用：该员工后续管理请求被拒绝；不影响客户授权或门户自助资格。</p>
                    </div>
                  </div>
                )}
              </div>
              {lastSuper && (
                <p className="administrator-callout administrator-callout--warning">{lastSuperReason}</p>
              )}
              <div className="administrator-template">
                <span>业务能力 · 已选 {permissions.length} / 7</span>
                <Select<string>
                  aria-label="套用业务模板"
                  placeholder="按职责快速选择"
                  disabled={locked}
                  value={undefined}
                  onChange={(value) => setPermissions([...templates[value]])}
                  options={Object.keys(templates).map((value) => ({
                    value,
                    label: value,
                  }))}
                />
                <Button
                  size="small"
                  disabled={locked}
                  onClick={() => setPermissions(Object.keys(permissionNames))}
                >
                  全选
                </Button>
                <Button
                  size="small"
                  disabled={locked}
                  onClick={() => setPermissions([])}
                >
                  清空
                </Button>
              </div>
              <div className="administrator-permission-grid">
                {Object.entries(permissionNames).map(([code, name]) => (
                  <Checkbox
                    aria-label={name}
                    key={code}
                    disabled={locked}
                    checked={permissions.includes(code)}
                    onChange={(event) =>
                      setPermissions((current) =>
                        event.target.checked
                          ? [...current, code]
                          : current.filter((value) => value !== code),
                      )
                    }
                  >
                    <strong>{name}</strong>
                    <span className="administrator-permission-desc">{permissionDescriptions[code]}</span>
                  </Checkbox>
                ))}
              </div>
              <label className="administrator-reason">
                <FieldLabel label="调整原因" required />
                <Input
                  aria-label="调整原因"
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="例如：接手订单接口维护"
                />
              </label>
            </fieldset>
            {baseline && (
              <div className="administrator-change-summary">
                <strong>本次变化</strong>
                <span>{changes.join("；") || "资格与业务权限未变化"}</span>
              </div>
            )}
          </section>
        )}
        <footer className="administrator-save-bar">
          <span>
            {missing ||
              (conflict
                ? "先核对最新记录后再提交。"
                : unknown
                  ? "先核对实际操作结果。"
                  : "身份与权限已准备，可确认提交。")}
          </span>
          <div>
            <Button disabled={busy} onClick={onClose}>
              取消
            </Button>
            {(revokes || demotes) && !submitDisabled ? (
              <ConfirmAction
                title={revokes ? `撤销 ${baseline!.displayName} 的管理资格？` : `将 ${baseline!.displayName} 降为普通管理员？`}
                description={
                  revokes
                    ? "撤销后该员工的后续管理请求立即被拒绝；客户授权与门户自助资格不受影响，之后可重新启用。"
                    : "降级后该员工不能再分配、调整或撤销他人的管理资格；已勾选的业务能力保持不变。"
                }
                okText={revokes ? "撤销资格" : "确认降级"}
                danger
                onConfirm={() => save()}
              >
                {submitButton}
              </ConfirmAction>
            ) : (
              submitButton
            )}
          </div>
        </footer>
      </form>
    </div>
  );
}
