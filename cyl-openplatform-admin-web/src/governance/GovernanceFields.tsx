import { useState } from "react";
import { Button, Input, InputNumber, Pagination, Segmented, Select, Table } from "antd";
import { LoadFeedback } from "@cyl/open-platform-web-shared/components";
import { FieldLabel, IdText, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import type { AdminApi } from "../access/api";
import {
  fresh,
  ipNames,
  targetNames,
  type Config,
  type Draft,
  type TargetDisplay,
  addresses,
  validation,
  type TargetType,
} from "./model";

/** 规则当前状态的统一外观：执行=警示、观察=信息、停用/未发布=中性。 */
export function RuleState({ value }: { value: Config | null }) {
  if (!value) return <StatusBadge tone="neutral">未发布</StatusBadge>;
  if (!value.enabled) return <StatusBadge tone="neutral">停用</StatusBadge>;
  return value.mode === "ENFORCE" ? <StatusBadge tone="warning">执行 · 超限拒绝</StatusBadge> : <StatusBadge tone="info">观察 · 不拦截</StatusBadge>;
}

interface TargetOption {
  id: string;
  name: string;
  appKey?: string;
  service?: string;
  version?: string;
  method?: string;
}
export function TargetPicker({
  api,
  kind,
  value,
  onChange,
}: {
  api: AdminApi;
  kind: "APPLICATION" | "API";
  value: string | null;
  onChange: (item: TargetOption) => void;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<TargetOption | null>(null);
  const [open, setOpen] = useState(!value);
  const list = useReadPage<TargetOption>(
    api,
    `/${kind === "APPLICATION" ? "applications" : "apis"}?page=${page}&pageSize=20&query=${encodeURIComponent(filter)}`,
    0,
    open,
  );
  return (
    <section className="traffic-picker" aria-label={`选择${targetNames[kind]}`}>
      <div className="traffic-inline">
        <FieldLabel label={targetNames[kind]} required />
        <span className={selected || value ? "" : "op-muted"}>{selected?.name ?? value ?? "尚未选择"}</span>
        {value && (
          <Button size="small" type="link" onClick={() => setOpen(!open)}>
            {open ? "收起选择" : "更换"}
          </Button>
        )}
      </div>
      {open && (
        <>
          <Input.Search
            aria-label={`搜索${targetNames[kind]}`}
            placeholder={kind === "APPLICATION" ? "搜索凭据名称" : "搜索接口名称或 service.method"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onSearch={() => {
              setFilter(query.trim());
              setPage(1);
            }}
            enterButton="搜索"
          />
          <LoadFeedback {...list} retry={list.reload} />
          <Table<TargetOption>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={list.data?.items ?? []}
            scroll={{ y: 240 }}
            columns={[
              {
                title: "名称 / 标识",
                render: (_, item) => (
                  <div className="op-cell-main">
                    <span className="op-cell-main__title">{item.name}</span>
                    <span className="op-cell-sub op-code">{item.appKey ? `AK ${item.appKey}` : `${item.service}/${item.version}/${item.method}`}</span>
                  </div>
                ),
              },
              {
                title: "操作",
                width: 80,
                render: (_, item) => (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setSelected(item);
                      onChange(item);
                      setOpen(false);
                    }}
                  >
                    选择
                  </Button>
                ),
              },
            ]}
          />
          {list.data && list.data.total > 20 && (
            <Pagination simple size="small" current={page} pageSize={20} total={list.data.total} onChange={setPage} aria-label="规则目标分页" />
          )}
        </>
      )}
    </section>
  );
}

/** 规则目标：名称在前、编号在后（悬停看完整、可复制）。 */
export function TargetFacts({ draft, showType = true }: { draft: Pick<Draft, "config" | "targetDisplay">; showType?: boolean }) {
  const t = draft.config.target,
    d = draft.targetDisplay;
  const lines = [
    t.tenantId && (
      <span key="tenant" className="traffic-target-line">
        <span className="op-muted">租户</span>
        <IdText value={t.tenantId} label="租户 ID" maxChars={24} />
      </span>
    ),
    t.applicationId && (
      <span key="app" className="traffic-target-line">
        <span className="op-muted">凭据</span>
        <span>{d?.applicationName || "名称暂不可用"}</span>
        {d?.appKey ? <IdText value={d.appKey} label="AK" maxChars={14} /> : <IdText value={t.applicationId} label="凭据 ID" maxChars={14} />}
      </span>
    ),
    t.apiId && (
      <span key="api" className="traffic-target-line">
        <span className="op-muted">API</span>
        <span>{d?.apiName || "名称暂不可用"}</span>
        {d?.service ? <span className="op-code op-muted">{`${d.service}#${d.method}`}</span> : <IdText value={t.apiId} label="API ID" maxChars={14} />}
      </span>
    ),
  ].filter(Boolean);
  return (
    <div className="traffic-target-facts">
      {showType && <span className="traffic-target-type">{targetNames[t.type]}</span>}
      {lines}
    </div>
  );
}

export function TargetFields({
  api,
  types,
  config,
  onChange,
  onDisplay,
  display,
}: {
  api: AdminApi;
  display: TargetDisplay;
  onDisplay: (value: TargetDisplay) => void;
  types: TargetType[];
  config: Config;
  onChange: (value: Config) => void;
}) {
  return (
    <div className="traffic-fields">
      <div className="traffic-field">
        <FieldLabel label="目标类型" help="目标在创建后固定；不同对象请新增规则，避免把已有生效策略转移到其他对象。" />
        <Select
          aria-label="目标类型"
          value={config.target.type}
          options={types.map((value) => ({ value, label: targetNames[value] }))}
          onChange={(type) => onChange({ ...config, target: fresh(type).target })}
        />
      </div>
      {["TENANT", "TENANT_API"].includes(config.target.type) && (
        <label className="traffic-field">
          <FieldLabel label="租户 ID" required />
          <Input
            aria-label="租户 ID"
            maxLength={64}
            value={config.target.tenantId ?? ""}
            onChange={(e) => onChange({ ...config, target: { ...config.target, tenantId: e.target.value } })}
          />
        </label>
      )}
      {["APPLICATION", "APPLICATION_API"].includes(config.target.type) && (
        <TargetPicker
          key={config.target.type + "app"}
          api={api}
          kind="APPLICATION"
          value={config.target.applicationId}
          onChange={(item) => {
            onDisplay({ ...display, applicationName: item.name, appKey: item.appKey });
            onChange({ ...config, target: { ...config.target, applicationId: item.id } });
          }}
        />
      )}
      {["API", "TENANT_API", "APPLICATION_API"].includes(config.target.type) && (
        <TargetPicker
          key={config.target.type + "api"}
          api={api}
          kind="API"
          value={config.target.apiId}
          onChange={(item) => {
            onDisplay({ ...display, apiName: item.name, service: item.service, version: item.version, method: item.method });
            onChange({ ...config, target: { ...config.target, apiId: item.id } });
          }}
        />
      )}
    </div>
  );
}

export function PolicyFields({
  config,
  setConfig,
  ipText,
  setIpText,
  disabled,
}: {
  config: Config;
  setConfig: (v: Config) => void;
  ipText: string;
  setIpText: (v: string) => void;
  disabled: boolean;
}) {
  const ipError = validation("valid", {
    ...config,
    ipAddresses: config.ipMode === "UNRESTRICTED" ? [] : addresses(ipText),
  }).find((message) => message.startsWith("IP"));
  const number = (label: string, value: number, max: number, onChange: (n: number) => void, min = 0) => (
    <label className="traffic-field">
      <FieldLabel label={label} />
      <InputNumber
        aria-label={label}
        min={min}
        max={max}
        precision={0}
        value={Number.isFinite(value) ? value : null}
        onChange={(v) => onChange(v ?? NaN)}
        disabled={disabled}
        style={{ width: "100%" }}
      />
    </label>
  );
  return (
    <div className="traffic-policy">
      <section className="traffic-section" aria-label="生效方式">
        <h3>生效方式</h3>
        <div className="traffic-grid">
          <div className="traffic-field">
            <FieldLabel label="运行模式" help="保存只更新草稿。观察使用独立计数，预计超限也会放行；执行会拒绝超限请求。其他匹配规则仍会生效。" />
            <Segmented
              aria-label="运行模式"
              disabled={disabled}
              value={config.mode}
              options={[
                { value: "OBSERVE", label: "观察" },
                { value: "ENFORCE", label: "执行" },
              ]}
              onChange={(mode) => setConfig({ ...config, mode: mode as Config["mode"] })}
            />
            <span className="op-cell-sub">{config.mode === "ENFORCE" ? "超限或 IP 不匹配会拒绝调用" : "只记录预计拒绝，不拦截请求"}</span>
          </div>
          <div className="traffic-field">
            <FieldLabel label="发布后状态" help="停用只停止此规则的拦截与计数，其他匹配规则仍有效。" />
            <Segmented
              aria-label="发布后状态"
              disabled={disabled}
              value={config.enabled ? "on" : "off"}
              options={[
                { value: "on", label: "启用" },
                { value: "off", label: "停用" },
              ]}
              onChange={(v) => setConfig({ ...config, enabled: v === "on" })}
            />
          </div>
        </div>
      </section>
      <section className="traffic-section" aria-label="请求额度">
        <h3>请求额度</h3>
        <div className="traffic-field">
          <FieldLabel
            label="限速方式"
            help="每秒补充表示持续速率，突发容量表示最多积累多少次请求。新桶初始满额；停启和回滚不重置已有日用量。UTC 零点对应北京时间 08:00。"
          />
          <Segmented
            aria-label="限速方式"
            disabled={disabled}
            value={config.rate.algorithm}
            onChange={(value) =>
              setConfig({
                ...config,
                rate: value === "NONE" ? { algorithm: "NONE", perSecond: 0, burst: 0 } : fresh(config.target.type).rate,
              })
            }
            options={[
              { value: "TOKEN_BUCKET", label: "限制速率" },
              { value: "NONE", label: "不限速" },
            ]}
          />
        </div>
        <div className="traffic-grid traffic-grid--three">
          {config.rate.algorithm === "TOKEN_BUCKET" && (
            <>
              {number("每秒补充请求数", config.rate.perSecond, 1000000, (n) => setConfig({ ...config, rate: { ...config.rate, perSecond: n } }), 1)}
              {number("突发容量", config.rate.burst, 1000000, (n) => setConfig({ ...config, rate: { ...config.rate, burst: n } }), 1)}
            </>
          )}
          {number("每日请求上限（UTC，0 不限）", config.dailyQuota, 100000000, (n) => setConfig({ ...config, dailyQuota: n }))}
        </div>
      </section>
      <section className="traffic-section" aria-label="IP 访问范围">
        <h3>IP 访问范围</h3>
        <div className="traffic-field">
          <FieldLabel label="IP 策略" help="只接受 IPv4/IPv6 字面地址或 CIDR，不解析域名。允许名单为空会拒绝全部 IP；拒绝名单为空不拒绝任何 IP。" />
          <Select
            aria-label="IP 策略"
            disabled={disabled}
            value={config.ipMode}
            options={Object.entries(ipNames).map(([value, label]) => ({ value, label }))}
            onChange={(ipMode) => setConfig({ ...config, ipMode })}
          />
        </div>
        {config.ipMode !== "UNRESTRICTED" && (
          <label className="traffic-field">
            <FieldLabel label="IP 或 CIDR（每行一个，最多100项）" />
            <Input.TextArea
              aria-label="IP 或 CIDR（每行一个，最多100项）"
              disabled={disabled}
              status={ipError ? "error" : undefined}
              value={ipText}
              onChange={(e) => setIpText(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 6 }}
              maxLength={5200}
              placeholder={"例如：192.168.1.0/24\n2001:db8::/32"}
            />
            {ipError && (
              <span role="alert" className="op-cell-sub op-cell-sub--error">
                {ipError}
              </span>
            )}
            {config.ipMode === "ALLOWLIST" && !ipText.trim() && <span className="op-cell-sub op-cell-sub--warning">允许名单为空：发布为执行模式会拒绝所有 IP。</span>}
          </label>
        )}
      </section>
    </div>
  );
}
