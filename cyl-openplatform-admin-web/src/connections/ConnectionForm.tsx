import { useEffect, useRef, useState } from "react";
import { Button, ConfigProvider, Input, Select } from "antd";
import { FieldHelp } from "@cyl/open-platform-web-shared/ui/components";
import type { AdminApi } from "../access/api";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import ConnectionDiagnostics from './ConnectionDiagnostics';
import { useAdminNavigation } from "../navigation/AdminNavigation";
import type {
  Configuration,
  ConnectionConfig,
  ConnectionDetail,
  Diagnostics,
} from "./types";
import "./connections-workspace.css";

const emptyConfig = (): ConnectionConfig => ({
  registry: { address: "", namespace: "", group: "", credentialRef: null },
  metadata: {
    type: "NONE",
    address: null,
    namespace: null,
    group: null,
    database: null,
    credentialRef: null,
  },
  discoveryMode: "INTERFACE",
  providerMetadataMode: "LOCAL",
});

/** 99 精简连接表单（在连接抽屉中使用）：维护已保存连接修订，未保存输入受离开保护。 */
export default function ConnectionForm({
  api,
  configuration,
  detail = null,
  copy = false,
  canManage,
  onSaved,
  onClose,
}: {
  api: AdminApi;
  configuration: Configuration;
  detail?: ConnectionDetail | null;
  copy?: boolean;
  canManage: boolean;
  onSaved: (detail: ConnectionDetail) => void;
  onClose: () => void;
}) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const [name, setName] = useState(
    detail ? detail.connection.name + (copy ? "（副本）" : "") : "",
  );
  const [description, setDescription] = useState(
    detail?.connection.description || "",
  );
  const [config, setConfig] = useState<ConnectionConfig>(() =>
    detail ? structuredClone(detail.draft.config) : emptyConfig(),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<Diagnostics | null>(null);
  const [checkError, setCheckError] = useState('');
  const checkRequest = useRef<AbortController | null>(null);
  const fields = useRef<HTMLFieldSetElement>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const request = useRef<AbortController | null>(null);
  const saved = useRef<ConnectionDetail | null>(copy ? null : detail);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => checkRequest.current?.abort(), []);
  const applicationNeedsMetadata =
    config.discoveryMode === "APPLICATION" && config.metadata.type === "NONE";

  const registryFields = ["address", "namespace", "group", "credentialRef"] as const;
  const metadataIsEmpty = registryFields.every(key => !config.metadata[key]);
  const metadataMatchesRegistry = registryFields.every(key => (config.metadata[key] || "") === (config.registry[key] || ""));
  const canReuseRegistry = config.metadata.type === "NACOS" && Boolean(config.registry.address.trim())
    && (metadataIsEmpty || metadataMatchesRegistry)
    && (!config.registry.credentialRef || configuration.metadataCredentialRefs.includes(config.registry.credentialRef));

  const save = async (): Promise<boolean> => {
    if (!canManage) {
      setError("当前已无连接管理权限，输入已保留。");
      return false;
    }
    if (saving.current) return false;
    const invalid = Array.from(
      fields.current?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input,select,textarea") ?? [],
    ).find((input) => !input.validity.valid);
    if (invalid) {
      invalid.closest("details")?.setAttribute("open", "");
      invalid.scrollIntoView?.({ block: "center" });
      invalid.focus({ preventScroll: true });
      invalid.reportValidity();
      return false;
    }
    if (applicationNeedsMetadata) {
      setError("应用级发现需要Nacos或Redis元数据中心，请先选择元数据位置。");
      return false;
    }
    const abort = new AbortController();
    request.current = abort;
    saving.current = true;
    setBusy(true);
    setError("");
    const content = {
      name: name.trim(),
      description: description.trim(),
      config,
    };
    try {
      const previous = saved.current;
      const value = await api<ConnectionDetail>(previous
        ? `/dubbo-connections/${encodeURIComponent(previous.connection.id)}/draft` : '/dubbo-connections', {
        method: previous ? 'PUT' : 'POST', signal: abort.signal,
        body: { ...content, ...(previous ? { expectedStateVersion: previous.connection.stateVersion } : {}) },
      });
      if (abort.signal.aborted) return false;
      saved.current = value;
      dirty.current = false;
      onSaved(value);
      return true;
    } catch (failure) {
      if (!abort.signal.aborted)
        setError(
          (failure as Error).message,
        );
      return false;
    } finally {
      saving.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  useEffect(() => {
    return navigation.registerDraft({
      connectionId: route.connectionId || "new",
      connectionView: copy ? "copy" : "edit",
      dirty: () => dirty.current || saving.current,
      busy: () => saving.current,
      save,
    });
  }, [
    navigation.registerDraft,
    api,
    route.connectionId,
    name,
    description,
    config,
    busy,
    canManage,
    copy,
  ]);
  const changeConfig = (value: ConnectionConfig) => {
    dirty.current = true;
    setConfig(value);
  };
  const selectMetadata = (type: ConnectionConfig["metadata"]["type"]) => {
    if (type === config.metadata.type) return;
    if (
      config.metadata.type !== "NONE" &&
      !window.confirm(
        "切换元数据中心会清除当前元数据地址、隔离和账号引用，是否继续？",
      )
    )
      return;
    changeConfig({
      ...config,
      metadata: {
        type,
        address: type === "NONE" ? null : "",
        namespace: type === "NACOS" ? "" : null,
        group: type === "NONE" ? null : "",
        database: null,
        credentialRef: null,
      },
    });
  };
  const refs = (values: string[], current: string | null) => [
    { value: "", label: "不使用认证" },
    ...values.map((value) => ({ value, label: value })),
    ...(current && !values.includes(current) ? [{ value: current, label: `${current}（当前不可用）` }] : []),
  ];
  const content = (
    <>
      <ConfigProvider componentDisabled={busy || !canManage}>
        <fieldset
          ref={fields}
          className="connection-form-fields"
          disabled={busy || !canManage}
          onChangeCapture={() => {
            dirty.current = true;
          }}
        >
          <div className="connection-form-grid">
            <label>
              连接名称{" "}
              <Input
                aria-label="连接名称"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：订单服务注册中心"
              />
            </label>
            <label className="connection-field-wide">
              用途说明
              <Input.TextArea
                value={description}
                maxLength={2000}
                rows={2}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </div>
          <section className="connection-config-block">
            <div className="connection-section-heading">
              <h3>Nacos 注册中心</h3>
              <span className="connection-env op-code">{configuration.currentEnvironmentId}</span>
              <FieldHelp label="注册中心填写">这里定位服务实例。Namespace 填写 ID；注册 group 与 Dubbo 服务 group 不同。账号只引用部署配置，不在页面填写密码。</FieldHelp>
            </div>
            <div className="connection-form-grid">
              <label className="connection-field-wide">
                Nacos 地址
                <Input
                  required
                  maxLength={512}
                  value={config.registry.address}
                  onChange={(event) =>
                    changeConfig({
                      ...config,
                      registry: {
                        ...config.registry,
                        address: event.target.value,
                      },
                    })
                  }
                  placeholder="nacos://主机:端口"
                />
              </label>
              <label>
                Namespace ID
                <Input
                  maxLength={128}
                  value={config.registry.namespace}
                  onChange={(event) =>
                    changeConfig({
                      ...config,
                      registry: {
                        ...config.registry,
                        namespace: event.target.value,
                      },
                    })
                  }
                  placeholder="默认空间可留空"
                />
              </label>
              <label>
                注册 group
                <Input
                  required
                  maxLength={128}
                  value={config.registry.group}
                  onChange={(event) =>
                    changeConfig({
                      ...config,
                      registry: {
                        ...config.registry,
                        group: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                Nacos 凭据引用
                <Select
                  aria-label="Nacos 凭据引用"
                  value={config.registry.credentialRef || ""}
                  onChange={(value: string) =>
                    changeConfig({
                      ...config,
                      registry: {
                        ...config.registry,
                        credentialRef: value || null,
                      },
                    })
                  }
                  options={refs(configuration.registryCredentialRefs, config.registry.credentialRef)}
                />
              </label>
              <label>
                服务发现方式
                <Select
                  aria-label="服务发现方式"
                  value={config.discoveryMode}
                  onChange={(discoveryMode: ConnectionConfig["discoveryMode"]) => changeConfig({ ...config, discoveryMode })}
                  options={[
                    { value: "INTERFACE", label: "接口级发现" },
                    { value: "APPLICATION", label: "应用级发现" },
                  ]}
                />
              </label>
            </div>
          </section>
          <section className="connection-config-block" aria-label="检查已保存注册中心">
            <div className="connection-section-heading"><h3>只读检查</h3>
              <Button loading={checking} disabled={!saved.current || checking || busy} onClick={async () => {
                if (!saved.current || checking) return;
                const current = saved.current, abort = new AbortController();
                checkRequest.current = abort; setChecking(true); setCheckError(''); setCheckResult(null);
                try {
                  const value = await api<Diagnostics>(`/dubbo-connections/${encodeURIComponent(current.connection.id)}/diagnostics`, {
                    method: 'POST', body: { revision: current.draft.revision }, signal: abort.signal,
                  });
                  if (!abort.signal.aborted) setCheckResult(value);
                } catch (reason) { if (!abort.signal.aborted) setCheckError((reason as Error).message); }
                finally { if (!abort.signal.aborted) setChecking(false); }
              }}>检查注册中心</Button>
            </div>
            <p className="connection-hint">{saved.current
              ? `检查已保存草稿 r${stringifyJson(saved.current.draft.revision)}，当前表单修改不参与本次检查。`
              : '先保存连接草稿，再检查已保存修订；检查不会调用业务方法。'}</p>
            {checkError && <p role="alert" className="connection-error">{checkError}</p>}
            {checkResult && <ConnectionDiagnostics result={checkResult} />}
          </section>
          <details className="connection-config-block connection-runtime-options" open={config.discoveryMode === "APPLICATION" || config.metadata.type !== "NONE"}>
            <summary className="connection-section-heading">
              <span>运行发现设置（按需）</span>
              <FieldHelp label="运行发现选择">应用级发现仍需接口到应用映射和运行元数据。LOCAL / REMOTE 取决于提供方实际模式；注册中心检查不读取这些资源，不查方法定义。</FieldHelp>
            </summary>
            <div className="connection-form-grid">
              <label>
                元数据位置
                <Select
                  aria-label="元数据位置"
                  value={config.metadata.type}
                  onChange={(type: ConnectionConfig["metadata"]["type"]) => selectMetadata(type)}
                  options={[
                    { value: "NONE", label: "不使用元数据中心" },
                    { value: "NACOS", label: "Nacos 元数据中心" },
                    { value: "REDIS", label: "Redis 元数据中心" },
                  ]}
                />
              </label>
              <label>
                提供方实际元数据模式
                <Select
                  aria-label="提供方实际元数据模式"
                  value={config.providerMetadataMode}
                  onChange={(providerMetadataMode: ConnectionConfig["providerMetadataMode"]) => changeConfig({ ...config, providerMetadataMode })}
                  options={[
                    { value: "LOCAL", label: "LOCAL · 提供方本地提供" },
                    { value: "REMOTE", label: "REMOTE · 提供方上报中心" },
                  ]}
                />
              </label>
              {applicationNeedsMetadata && (
                <p
                  className="connection-field-wide connection-field-error"
                  role="alert"
                >
                  应用级发现需要元数据中心，请选择Nacos或Redis。
                </p>
              )}
              {config.metadata.type !== "NONE" && (
                <>
                  <label className="connection-field-wide">
                    元数据地址
                    <Input
                      required
                      maxLength={512}
                      value={config.metadata.address || ""}
                      placeholder={
                        config.metadata.type === "REDIS"
                          ? "redis://主机:端口 或 rediss://主机:端口"
                          : "nacos://主机:端口"
                      }
                      onChange={(event) =>
                        changeConfig({
                          ...config,
                          metadata: {
                            ...config.metadata,
                            address: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  {canReuseRegistry && (
                    <Button
                      className="connection-field-wide"
                      type="text"
                      onClick={() => {
                        changeConfig({
                          ...config,
                          metadata: { ...config.metadata, ...config.registry },
                        });
                      }}
                    >
                      复用上方 Nacos 定位
                    </Button>
                  )}
                  {config.metadata.type === "REDIS" ? (
                    <label>
                      Redis database
                      <input
                        required
                        type="number"
                        min="0"
                        max="2147483647"
                        step="1"
                        value={config.metadata.database ?? ""}
                        onChange={(event) =>
                          changeConfig({
                            ...config,
                            metadata: {
                              ...config.metadata,
                              database:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ) : (
                    <label>
                      元数据 Namespace ID
                      <Input
                        maxLength={128}
                        value={config.metadata.namespace || ""}
                        onChange={(event) =>
                          changeConfig({
                            ...config,
                            metadata: {
                              ...config.metadata,
                              namespace: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  )}
                  <label>
                    元数据 group
                    <Input
                      required
                      maxLength={128}
                      value={config.metadata.group || ""}
                      onChange={(event) =>
                        changeConfig({
                          ...config,
                          metadata: {
                            ...config.metadata,
                            group: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    元数据凭据引用
                    <Select
                      aria-label="元数据凭据引用"
                      value={config.metadata.credentialRef || ""}
                      onChange={(value: string) =>
                        changeConfig({
                          ...config,
                          metadata: {
                            ...config.metadata,
                            credentialRef: value || null,
                          },
                        })
                      }
                      options={refs(configuration.metadataCredentialRefs, config.metadata.credentialRef)}
                    />
                  </label>
                </>
              )}
            </div>
          </details>
        </fieldset>
      </ConfigProvider>
      {!canManage && (
        <p role="alert" className="connection-field-error">
          当前没有连接管理权限。输入已保留，不能保存或启用。
        </p>
      )}
      {error && (
        <p role="alert" className="connection-field-error">
          {error} 输入已保留；冲突时请核对最新连接。
        </p>
      )}
      <footer className="connection-form-actions">
        <span>
          保存连接草稿后可检查注册中心；启用修订不会重绑已有API。
        </span>
        <Button disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          type="primary"
          disabled={busy || !canManage || applicationNeedsMetadata}
          aria-busy={busy}
          htmlType="submit"
        >
          {busy ? "正在保存…" : "保存连接草稿"}
        </Button>
      </footer>
    </>
  );
  return (
    <form
      className="connection-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save().then((success) => {
          if (success)
            navigation.navigate(
              {
                ...route,
                connectionId: saved.current!.connection.id,
                connectionView: "detail",
              },
              true,
            );
        });
      }}
    >
      {content}
    </form>
  );
}
