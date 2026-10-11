import { useEffect, useRef, useState } from "react";
import { Button, Popover } from "antd";
import { issueDebugToken, type DebugToken } from "./tokenApi";

/**
 * 高级调试身份：用 AK / Secret 就近换取业务 Token。表单不受控，Secret 提交即从输入框清除，
 * 卸载时重置，不进入组件状态。
 */
export function DebugTokenForm({
  onClose,
  onIssued,
  requireEmployee = false,
}: {
  onClose: () => void;
  onIssued: (token: DebugToken) => void;
  requireEmployee?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const fields = form.current;
    return () => {
      pending.current?.abort();
      fields?.reset();
    };
  }, []);

  return (
    <form
      ref={form}
      className="op-debug-token"
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        const tenantId = String(data.get("tenantId") || "").trim();
        const appKey = String(data.get("appKey") || "").trim();
        const appSecret = String(data.get("appSecret") || "");
        const employeeNo = String(data.get("employeeNo") || "").trim();
        setError("");
        if (!tenantId || !/^[a-f0-9]{32}$/.test(appKey) || !appSecret.trim()) {
          setError("请填写调用租户 ID、32 位 AK 和配套 Secret。");
          return;
        }
        if (requireEmployee && !employeeNo) {
          setError("此API需要人员身份，请填写已获委托的员工号。");
          return;
        }
        (event.currentTarget.elements.namedItem("appSecret") as HTMLInputElement).value = "";
        const abort = new AbortController();
        pending.current = abort;
        setBusy(true);
        try {
          const token = await issueDebugToken({ tenantId, appKey, appSecret, ...(employeeNo ? { employeeNo } : {}) }, abort.signal);
          if (!abort.signal.aborted) onIssued(token);
        } catch (failure) {
          if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "未收到 Token，请核对后重试。");
        } finally {
          if (!abort.signal.aborted) setBusy(false);
        }
      }}
    >
      <p className="op-debug-token__intro">
        填写调用方凭据，获取后自动回到请求准备。
        <Popover
          trigger="click"
          content={
            <div className="op-debug-help">
              在门户 API 配置查看 AK，Secret 使用创建时保存的值。租户填写应用已获授权的目标租户，不自动使用后台登录身份。{" "}
              <a href="/portal/?section=settings" target="_blank" rel="noopener noreferrer">
                去门户查找凭据
              </a>
            </div>
          }
        >
          <Button type="link" size="small">
            凭据从哪里来？
          </Button>
        </Popover>
      </p>
      <fieldset disabled={busy} className="op-debug-token__fields">
        <label>
          <span>本次调用租户 ID *</span>
          <input aria-label="本次调用租户 ID" name="tenantId" maxLength={64} autoComplete="off" />
        </label>
        <label>
          <span>AK（AppKey）*</span>
          <input aria-label="AK（AppKey）" name="appKey" maxLength={32} autoComplete="off" />
        </label>
        <label>
          <span>Secret（AppSecret）*</span>
          <input aria-label="Secret（AppSecret）" name="appSecret" type="password" maxLength={128} autoComplete="off" />
        </label>
        <label>
          <span>已获委托的员工号（{requireEmployee ? "此API必填" : "可选"}）</span>
          <input aria-label={`已获委托的员工号（${requireEmployee ? "此API必填" : "可选"}）`} name="employeeNo" maxLength={64} autoComplete="off" />
        </label>
      </fieldset>
      <p className="op-muted">留空员工号以应用身份调用；填写不会自动新增委托，对应人员须已在调用租户内委托此应用。</p>
      {error && (
        <div className="op-debug__notice is-error">
          <p role="alert">{error}</p>
          <small>凭据无效：核对 AK 与 Secret 是否配套；无租户权限：请应用负责人确认目标租户授权；人员身份被拒绝：核对该租户内的人员委托。修正后重新输入 Secret。</small>
        </div>
      )}
      <div className="op-debug-token__actions">
        <Button autoInsertSpace={false} onClick={onClose}>
          取消
        </Button>
        <Button type="primary" htmlType="submit" loading={busy}>
          {busy ? "正在获取…" : "获取并用于本次测试"}
        </Button>
      </div>
    </form>
  );
}
