import { useEffect, useState } from "react";
import { Button, Input, Select, Space } from "antd";
import { FieldHelp, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import type { AdminApi } from "../access/api";
import { DebugTokenForm } from "./DebugTokenDialog";
import type { DebugToken } from "./tokenApi";
import {
  candidateLabel,
  employeeLabel,
  searchCandidates,
  searchEmployees,
  type IdentityCandidate,
  type IdentityChoice,
  type IdentityEmployee,
  type IdentityMode,
} from "./identity";

/** 远程搜索下拉：打开或输入时按 250ms 节流查询，晚到结果丢弃。 */
function useRemoteOptions<T>(load: (text: string, signal: AbortSignal) => Promise<{ items: T[] }>, open: boolean, key: string) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      load(text, abort.signal)
        .then((page) => !abort.signal.aborted && (setItems(page.items), setError("")))
        .catch((failure) => !abort.signal.aborted && setError((failure as Error).message))
        .finally(() => !abort.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, text, key]);
  return { text, setText, items, loading, error };
}

export interface TokenModeProps {
  token: string;
  identity: DebugToken | null;
  verifying: boolean;
  form: boolean;
  notice: string;
  onToken: (value: string) => void;
  onVerify: () => void;
  onForm: (open: boolean) => void;
  onIssued: (token: DebugToken) => void;
}

/**
 * 调用身份：默认从下拉选一个启用且有权调用此 API 的凭据（可再选人员），服务端按其当前授权代换身份执行；
 * “高级”里仍可粘贴业务 Token 或用 AK / Secret 换取 Token。
 */
export default function IdentityPanel({
  api,
  apiId,
  mode,
  onMode,
  choice,
  onChoice,
  requiresEmployee,
  busy,
  scopeCodes,
  tokenMode,
  onClear,
}: {
  api: AdminApi;
  apiId: string;
  mode: IdentityMode;
  onMode: (mode: IdentityMode) => void;
  choice: IdentityChoice | null;
  onChoice: (choice: IdentityChoice | null) => void;
  requiresEmployee: boolean;
  busy: boolean;
  scopeCodes?: string[];
  tokenMode: TokenModeProps;
  onClear: () => void;
}) {
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [employeesOpen, setEmployeesOpen] = useState(false);
  const candidates = useRemoteOptions<IdentityCandidate>((text, signal) => searchCandidates(api, apiId, text, signal), candidatesOpen, apiId);
  const grant = choice?.candidate.tenantGrantId ?? "";
  const employees = useRemoteOptions<IdentityEmployee>(
    (text, signal) => searchEmployees(api, apiId, grant, text, signal),
    employeesOpen && !!grant,
    grant,
  );
  const help = (
    <FieldHelp label="调用身份">
      平台用所选凭据在该租户下的当前授权构造调用身份执行草稿，不签发、不显示 Token；执行会记入管理审计。列表只含启用、且拥有此 API
      权限组（{scopeCodes?.join("、") || "未配置"}）的凭据。
    </FieldHelp>
  );
  return (
    <section className="op-debug-identity" aria-label="调用身份">
      {mode === "credential" ? (
        <div className="op-debug-identity__row">
          <span className="op-debug-identity__label">调用身份 {help}</span>
          <Select
            aria-label="调用凭据"
            className="op-debug-identity__credential"
            showSearch
            allowClear
            disabled={busy}
            filterOption={false}
            placeholder="搜索凭据名称、AK、租户或备注"
            value={choice?.candidate.tenantGrantId}
            labelRender={() => (choice ? candidateLabel(choice.candidate) : null)}
            loading={candidates.loading}
            onOpenChange={setCandidatesOpen}
            onSearch={candidates.setText}
            notFoundContent={candidates.error || (candidates.loading ? "正在查找…" : "没有可调用此 API 的凭据")}
            onChange={(value?: string) => {
              const candidate = candidates.items.find((item) => item.tenantGrantId === value);
              onChoice(candidate ? { candidate, employee: null } : null);
            }}
            options={candidates.items.map((item) => ({
              value: item.tenantGrantId,
              label: (
                <span className="op-debug-identity__option">
                  <strong>{item.applicationName}</strong>
                  <small>
                    {item.tenantName || item.tenantId}
                    {item.appKeyTail && ` · AK …${item.appKeyTail}`}
                    {item.note && ` · ${item.note}`}
                  </small>
                </span>
              ),
            }))}
          />
          {choice && (
            <Select
              aria-label="调用员工"
              className="op-debug-identity__employee"
              showSearch
              allowClear={!requiresEmployee}
              disabled={busy}
              filterOption={false}
              status={requiresEmployee && !choice.employee ? "warning" : undefined}
              placeholder={requiresEmployee ? "选择调用员工（此 API 必填）" : "可选：指定调用员工"}
              value={choice.employee?.userGrantId}
              labelRender={() => (choice.employee ? employeeLabel(choice.employee) : null)}
              loading={employees.loading}
              onOpenChange={setEmployeesOpen}
              onSearch={employees.setText}
              notFoundContent={employees.error || (employees.loading ? "正在查找…" : "该租户下没有已获授权的人员")}
              onChange={(value?: string) => onChoice({ ...choice, employee: employees.items.find((item) => item.userGrantId === value) ?? null })}
              options={employees.items.map((item) => ({ value: item.userGrantId, label: employeeLabel(item) }))}
            />
          )}
          <Button type="link" size="small" disabled={busy} onClick={() => onMode("token")}>
            高级：使用业务 Token
          </Button>
        </div>
      ) : (
        <TokenIdentity {...tokenMode} busy={busy} requiresEmployee={requiresEmployee} help={help} onBack={() => onMode("credential")} onClear={onClear} />
      )}
    </section>
  );
}

function TokenIdentity({
  token,
  identity,
  verifying,
  form,
  notice,
  onToken,
  onVerify,
  onForm,
  onIssued,
  busy,
  requiresEmployee,
  help,
  onBack,
  onClear,
}: TokenModeProps & { busy: boolean; requiresEmployee: boolean; help: React.ReactNode; onBack: () => void; onClear: () => void }) {
  return (
    <div className="op-debug-identity__token">
      <div className="op-debug-identity__row">
        <span className="op-debug-identity__label">业务 Token {help}</span>
        <Space.Compact size="small">
          <Button aria-pressed={!form} type={form ? "default" : "primary"} ghost={!form} disabled={busy} onClick={() => onForm(false)}>
            已有 Token
          </Button>
          <Button aria-pressed={form} type={form ? "primary" : "default"} ghost={form} disabled={busy} onClick={() => onForm(true)}>
            用 AK / Secret 获取 Token
          </Button>
        </Space.Compact>
        {identity ? (
          <Space size="small" wrap>
            <StatusBadge tone="success">已核验</StatusBadge>
            <span>
              租户 {identity.context.tenantId} · {identity.context.employeeNo ? `员工 ${identity.context.employeeNo}` : "应用身份"}
            </span>
            <small className="op-muted">有效至 {new Date(identity.expiresAt).toLocaleString()}</small>
          </Space>
        ) : (
          token.trim() && <StatusBadge tone="warning">执行时核验</StatusBadge>
        )}
        <span className="op-debug-identity__spacer" />
        <Button type="link" size="small" disabled={busy} onClick={onClear}>
          清除调试身份与结果
        </Button>
        <Button type="link" size="small" disabled={busy} onClick={onBack}>
          改用选择凭据
        </Button>
      </div>
      {form ? (
        <DebugTokenForm requireEmployee={requiresEmployee} onClose={() => onForm(false)} onIssued={onIssued} />
      ) : (
        <div className="op-debug-identity__row">
          <Input.Password
            aria-label="业务访问 Token"
            className="op-debug-identity__input"
            autoComplete="off"
            maxLength={4096}
            value={token}
            disabled={busy}
            visibilityToggle={false}
            placeholder="粘贴 Token 即可测试；核验后可查看真实身份"
            onChange={(event) => onToken(event.target.value)}
          />
          <Button loading={verifying} disabled={busy || !token.trim() || verifying} onClick={onVerify}>
            核验身份与有效期
          </Button>
        </div>
      )}
      {notice && (
        <p className="op-muted" role="status">
          {notice}
        </p>
      )}
      {requiresEmployee && !identity?.context.employeeNo && <p className="op-debug-identity__hint">此 API 要求人员身份，请使用已获委托员工的 Token。</p>}
    </div>
  );
}
