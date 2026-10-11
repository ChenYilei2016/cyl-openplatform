import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { EntityDrawer, FieldLabel } from "@cyl/open-platform-web-shared/ui/components";
import { useDebouncedCallback } from "@cyl/open-platform-web-shared/ui/list";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button, Input, Select } from "antd";
import { useEffect, useRef, useState } from "react";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import type { AdminApi, Application, Scope } from "./api";

/**
 * 新建凭据：归属租户与初始权限组，内部名称由服务端生成。初始权限组预选“新凭据默认授予”的已启用组，可增删；
 * 创建成功后由凭据抽屉一次性展示 AppSecret。
 */
export default function CreateCredentialDrawer({
  api,
  onClose,
  onCreated,
}: {
  api: AdminApi;
  onClose: () => void;
  onCreated: (application: Application, appSecret: string) => void;
}) {
  const navigation = useAdminNavigation();
  const [ownerTenantId, setOwnerTenantId] = useState(""),
    [scopeCodes, setScopeCodes] = useState<string[] | null>(null),
    [scopeQuery, setScopeQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const writing = useRef(false),
    release = useRef<(() => void) | null>(null);
  const debounced = useDebouncedCallback(setScopeQuery);
  const defaults = useReadPage<Scope>(api, "/scopes?page=1&pageSize=100&enabled=true&defaultForNewApplication=true");
  const scopes = useReadPage<Scope>(api, `/scopes?page=1&pageSize=50&enabled=true&query=${encodeURIComponent(scopeQuery)}`, 0, true, { keepPrevious: true });
  const defaultCodes = defaults.data?.items.map((scope) => scope.code) ?? [];
  const selected = scopeCodes ?? defaultCodes;
  const names = Object.fromEntries([...(defaults.data?.items ?? []), ...(scopes.data?.items ?? [])].map((scope) => [scope.code, scope.name]));
  const dirty = Boolean(ownerTenantId || scopeCodes);

  useEffect(() => {
    const unregister = navigation.registerDraft({
      applicationId: "new",
      dirty: () => writing.current || dirty,
      busy: () => writing.current,
      save: async () => false,
      canSave: false,
      leaveMessage: "新凭据尚未创建；离开将放弃当前输入。",
    });
    release.current = unregister;
    return unregister;
  }, [navigation.registerDraft, dirty]);

  const cancel = () => {
    if (busy) return;
    if (dirty && !window.confirm("放弃当前创建输入？")) return;
    onClose();
  };
  const submit = async () => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ application: Application; appSecret: string }>("/applications", {
        method: "POST",
        // 默认权限组读取失败且未手动选择时不传 scopeCodes，由服务端按“新凭据默认授予”授予。
        body: { ownerTenantId: ownerTenantId.trim(), scopeCodes: scopeCodes ?? (defaults.data ? defaultCodes : undefined) },
      });
      release.current?.();
      onCreated(result.application, result.appSecret);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  return (
    <EntityDrawer
      open
      title="新建接入凭据"
      subtitle="创建后只显示一次 AppSecret；归属不等于调用授权，创建后再绑定可调用的租户。"
      onClose={cancel}
      footer={
        <div className="op-drawer-footer">
          <Button disabled={busy} onClick={cancel}>取消</Button>
          <Button type="primary" htmlType="submit" form="create-credential" loading={busy} disabled={defaults.loading && scopeCodes === null}>
            创建并生成 Secret
          </Button>
        </div>
      }
    >
      <form
        id="create-credential"
        className="credential-create"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          <FieldLabel label="归属租户 ID" required help="记录凭据所有者，不代表获得调用授权。" />
          <Input aria-label="归属租户 ID" required maxLength={64} value={ownerTenantId} disabled={busy} onChange={(event) => setOwnerTenantId(event.target.value)} />
        </label>
        <div>
          <FieldLabel label="初始权限组" help="默认选中“新凭据默认授予”的已启用权限组；可增删，最多 100 个。创建后可在凭据的权限组页调整。" />
          <Select
            mode="multiple"
            aria-label="初始权限组"
            className="credential-create__scopes"
            value={selected}
            disabled={busy}
            showSearch
            filterOption={false}
            onSearch={debounced.run}
            loading={scopes.loading || defaults.loading}
            placeholder="不选择则不授予任何权限组"
            notFoundContent={scopes.error || "没有匹配的已启用权限组"}
            maxCount={100}
            onChange={(values: string[]) => setScopeCodes(values)}
            options={[...new Set([...selected, ...(scopes.data?.items.map((scope) => scope.code) ?? [])])].map((code) => ({
              value: code,
              label: names[code] ? `${names[code]}（${code}）` : code,
            }))}
          />
          {defaults.error && <p className="op-cell-sub op-cell-sub--error">默认权限组读取失败：{defaults.error}</p>}
        </div>
        <ErrorFeedback error={error} />
      </form>
    </EntityDrawer>
  );
}
