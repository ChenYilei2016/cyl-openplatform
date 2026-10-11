import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Input, Pagination, Steps, Table } from "antd";
import type { AdminApi, Page } from "../access/api";
import { AdminApiError } from "../access/api";
import { ErrorFeedback } from "@cyl/open-platform-web-shared/components";
import { DisabledReason, EntityDrawer, FieldHelp, FieldLabel, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import { PolicyFields, RuleState, TargetFacts, TargetFields } from "./GovernanceFields";
import {
  addresses,
  fresh,
  ipNames,
  modeNames,
  quotaText,
  rateText,
  validation,
  type Config,
  type Draft,
  type Preview,
  type Release,
  type TargetDisplay,
  type TargetType,
} from "./model";

const same = (a: unknown, b: unknown) => stringifyJson(a) === stringifyJson(b);
const isStatus = (error: unknown, status: number) =>
  error instanceof AdminApiError && (error.code === status || Math.floor(error.code / 100000) === status);
const definite = (error: unknown) =>
  error instanceof AdminApiError &&
  !isStatus(error, 401) &&
  !isStatus(error, 403) &&
  ((error.code >= 400 && error.code < 500) || (error.code >= 40000000 && error.code < 50000000));
const root = (id: string) => `/governance-rules/${encodeURIComponent(id)}`;

const facts = (name: string | null | undefined, c: Config | null) =>
  c
    ? [name ?? "—", c.enabled ? "启用" : "停用", modeNames[c.mode], rateText(c), quotaText(c), ipNames[c.ipMode] + (c.ipAddresses.length ? " · " + c.ipAddresses.join("、") : "")]
    : Array(6).fill("未发布");

/** 发布差异：逐项对比当前生效（或最新草稿）与本次候选，变化项高亮。 */
function Comparison({
  beforeName,
  before,
  name,
  after,
  editingConflict = false,
}: {
  beforeName?: string | null;
  before: Config | null;
  name: string;
  after: Config;
  editingConflict?: boolean;
}) {
  const left = facts(beforeName, before),
    right = facts(name, after);
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="label"
      rowClassName={(row) => (row.changed ? "traffic-diff-row--changed" : "")}
      dataSource={["规则名称", "发布后状态", "运行模式", "速率 / 突发", "日配额", "IP 范围"].map((label, i) => ({
        label,
        before: left[i],
        after: right[i],
        changed: left[i] !== right[i],
      }))}
      columns={[
        { title: "核对项", dataIndex: "label", width: 120 },
        { title: editingConflict ? "最新草稿" : "当前生效", dataIndex: "before" },
        {
          title: editingConflict ? "本次输入" : "本次候选",
          render: (_, r) =>
            r.changed ? (
              <span className="traffic-diff-after">
                <StatusBadge tone="info">变更</StatusBadge>
                {r.after}
              </span>
            ) : (
              r.after
            ),
        },
      ]}
    />
  );
}

async function targetId(target: Config["target"]) {
  if (target.type === "API") return "API:" + target.apiId;
  if (target.type === "APPLICATION") return "APPLICATION:" + target.applicationId;
  const t = target.tenantId ?? "",
    a = target.applicationId ?? "",
    p = target.apiId ?? "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${target.type}:${t.length}:${t}${a.length}:${a}${p.length}:${p}`));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

/**
 * 规则抽屉：新增（选目标 → 配置策略）、编辑草稿、核对差异后发布、版本记录与回滚，沿用 83/104 的规则模型与发布流程。
 * 地址 `rule=<id|new>` 决定打开哪条规则；关闭或切换受未保存保护。
 */
export default function RuleDrawer({
  api,
  ruleId,
  allowedTypes,
  onChanged,
  overview,
}: {
  api: AdminApi;
  ruleId: string | null;
  allowedTypes: TargetType[];
  /** 草稿或发布写入成功后刷新列表。 */
  onChanged: () => void;
  /** 当前生效版本的近 1 小时命中与跳转入口（由列表提供，抽屉不重复查询）。 */
  overview?: (draft: Draft) => ReactNode;
}) {
  const navigation = useAdminNavigation();
  const [draft, setDraft] = useState<Draft | null>(null),
    [name, setName] = useState(""),
    [config, setConfig] = useState<Config>(fresh(allowedTypes[0] ?? "API")),
    [ipText, setIpText] = useState("");
  const [targetDisplay, setTargetDisplay] = useState<TargetDisplay>({});
  const [phase, setPhase] = useState<"target" | "policy">("target"),
    [tab, setTab] = useState<"edit" | "history">("edit");
  const [preview, setPreview] = useState<Preview | null>(null),
    [history, setHistory] = useState<Page<Release> | null>(null),
    [historyPage, setHistoryPage] = useState(1);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [canRetry, setCanRetry] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ id: string; name: string; config: Config } | null>(null),
    [latest, setLatest] = useState<Draft | null>(null),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [readRevision, setReadRevision] = useState(0);
  const adoptedRoute = useRef<string | null>(null);
  const writing = useRef(false),
    mounted = useRef(true),
    releaseGuard = useRef<(() => void) | null>(null);
  const bodyConfig = { ...config, ipAddresses: config.ipMode === "UNRESTRICTED" ? [] : addresses(ipText) };
  const changed = draft
    ? name !== draft.name || !same(bodyConfig, draft.config)
    : Boolean(name || config.target.tenantId || config.target.applicationId || config.target.apiId || !same(bodyConfig, fresh(allowedTypes[0] ?? "API")));
  const problems = validation(name, bodyConfig),
    locked = busy || unknown || Boolean(pendingSave);
  // 保存与发布不可用时的原因（按优先级取第一条），悬停显示。
  const blockedReason = locked
    ? "正在处理，或有结果待核对"
    : loading
      ? "正在读取规则"
      : latest
        ? "规则已被他人更新，请先处理冲突"
        : needsRefresh
          ? "请先刷新到最新规则"
          : problems[0] ?? "";

  function adopt(value: Draft) {
    setDraft(value);
    setName(value.name);
    setConfig(value.config);
    setIpText(value.config.ipAddresses.join("\n"));
    setLatest(null);
    setNeedsRefresh(false);
    setPhase("policy");
  }
  /** 新建规则取得真实 ID 后替换地址，不重新读取、不丢当前抽屉状态。 */
  function adoptRoute(id: string) {
    if (ruleId !== "new") return;
    adoptedRoute.current = id;
    releaseGuard.current?.();
    navigation.navigate({ ...navigation.route, page: "governance", governanceRuleId: id }, true);
  }
  function resolveConflict(keepInput: boolean) {
    if (!latest) return;
    if (keepInput) {
      setDraft(latest);
      setLatest(null);
      setNeedsRefresh(false);
    } else adopt(latest);
    setError("");
    adoptRoute(latest.id);
  }
  function begin() {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    return true;
  }
  function finish() {
    writing.current = false;
    if (mounted.current) setBusy(false);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (adoptedRoute.current === ruleId) {
      adoptedRoute.current = null;
      return;
    }
    const controller = new AbortController();
    setError("");
    setMessage("");
    setPreview(null);
    setHistory(null);
    setLatest(null);
    setNeedsRefresh(false);
    setTab("edit");
    setTargetDisplay({});
    setUnknown(false);
    setPendingSave(null);
    if (!ruleId || ruleId === "new") {
      setDraft(null);
      setName("");
      setConfig(fresh(allowedTypes[0] ?? "API"));
      setIpText("");
      setPhase("target");
      setLoading(false);
      return;
    }
    setLoading(true);
    setDraft(null);
    void api<Draft>(root(ruleId), { signal: controller.signal })
      .then((v) => {
        if (!controller.signal.aborted) adopt(v);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, ruleId, readRevision]);
  useEffect(() => {
    if (!ruleId) return;
    const release = navigation.registerDraft({
      governanceRuleId: ruleId,
      dirty: () => changed || locked,
      busy: () => locked,
      canSave: false,
      save: async () => false,
      leaveMessage: "未保存的规则配置将丢失；已保存草稿不会生效。",
    });
    releaseGuard.current = release;
    return release;
  }, [ruleId, changed, locked, navigation.registerDraft]);
  useEffect(() => {
    if (!ruleId || (!changed && !locked)) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [ruleId, changed, locked]);
  const close = () => navigation.navigate({ ...navigation.route, page: "governance", apiId: null, governanceRuleId: null });

  async function refreshCurrent() {
    if (!draft || !begin()) return;
    try {
      const value = await api<Draft>(root(draft.id));
      if (changed) setLatest(value);
      else adopt(value);
      setNeedsRefresh(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  async function readPreview(id: string, sourceReleaseId: string | null = null) {
    setPreview(null);
    const value = await api<Preview>(root(id) + "/preview", { method: "POST", body: { sourceReleaseId } });
    // 预览取服务器固定候选；读到新修订不能悄悄发布另一个人的草稿。
    if (!sourceReleaseId && draft && value.draftRevision !== draft.draftRevision && !changed) {
      setNeedsRefresh(true);
      throw new Error("草稿已被其他人更新，请读取最新草稿后重新核对。");
    }
    setPreview(value);
  }
  async function save(andPreview = false) {
    if (problems.length || locked || needsRefresh || latest || !begin()) return;
    let id = draft?.id;
    let savedConfirmed = false;
    try {
      if (!id) id = await targetId(config.target);
      const saved = await api<Draft>(draft ? root(id) : "/governance-rules", {
        method: draft ? "PUT" : "POST",
        body: { name, config: bodyConfig, ...(draft ? { expectedDraftRevision: draft.draftRevision } : {}) },
      });
      savedConfirmed = true;
      if (!mounted.current) return;
      adopt(saved);
      onChanged();
      setMessage("草稿已保存，核对发布后才生效。");
      if (!draft) adoptRoute(saved.id);
      if (andPreview) {
        const fixed = await api<Preview>(root(saved.id) + "/preview", { method: "POST", body: { sourceReleaseId: null } });
        if (fixed.draftRevision !== saved.draftRevision) {
          setNeedsRefresh(true);
          throw new Error("保存后草稿又被更新，请读取最新草稿后重新核对。");
        }
        setPreview(fixed);
      }
    } catch (e) {
      setError((e as Error).message);
      if (isStatus(e, 409)) {
        setNeedsRefresh(true);
        if (id) {
          try {
            setLatest(await api<Draft>(root(id)));
          } catch {
            /* 保留输入，手动重读。 */
          }
        }
      } else if (!savedConfirmed && id && !definite(e)) setPendingSave({ id, name, config: bodyConfig });
    } finally {
      finish();
    }
  }
  async function checkSave() {
    if (!pendingSave || !begin()) return;
    try {
      const current = await api<Draft>(root(pendingSave.id));
      setPendingSave(null);
      if (current.name === pendingSave.name && same(current.config, pendingSave.config)) {
        adopt(current);
        setMessage("已核对：草稿保存成功，尚未发布。");
        adoptRoute(current.id);
      } else {
        setLatest(current);
        setNeedsRefresh(true);
      }
    } catch (e) {
      if (isStatus(e, 404)) {
        setPendingSave(null);
        setNeedsRefresh(false);
        setMessage("该目标尚无已保存规则，可使用当前输入重新保存。");
      } else setError((e as Error).message);
    } finally {
      finish();
    }
  }
  async function previewChange(source: string | null = null) {
    if (!draft || locked || changed || needsRefresh || !begin()) return;
    try {
      await readPreview(draft.id, source);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  async function loadHistory(next = 1) {
    if (!draft || locked || !begin()) return;
    setTab("history");
    setPreview(null);
    try {
      setHistory(await api<Page<Release>>(root(draft.id) + `/releases?page=${next}&pageSize=20`));
      setHistoryPage(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  async function publish(queryOnly = false) {
    if (!draft || !preview || busy || (!queryOnly && unknown && !canRetry) || !begin()) return;
    try {
      const release = await api<Release>(
        root(draft.id) + (queryOnly ? `/results?previewDigest=${preview.digest}` : "/publish"),
        queryOnly
          ? undefined
          : {
              method: "POST",
              body: {
                expectedDraftRevision: preview.draftRevision,
                expectedStateVersion: preview.stateVersion,
                sourceReleaseId: preview.sourceReleaseId,
                previewDigest: preview.digest,
              },
            },
      );
      setUnknown(false);
      setCanRetry(false);
      setPreview(null);
      setMessage(`规则版本 v${release.rule.version} 已发布${release.sourceReleaseId ? "（从历史回滚）" : ""}。`);
      setDraft({ ...draft, stateVersion: release.rule.version, liveReleaseId: release.id, liveRule: release.rule, liveName: release.name });
      onChanged();
      setHistory(null);
      setTab("edit");
      try {
        adopt(await api<Draft>(root(draft.id)));
      } catch (e) {
        setNeedsRefresh(true);
        setError(`发布已确认成功，刷新草稿失败：${(e as Error).message}。请重新读取当前状态。`);
      }
    } catch (e) {
      if (queryOnly) setCanRetry(isStatus(e, 404));
      else if (definite(e)) {
        setPreview(null);
        setUnknown(false);
        setCanRetry(false);
        setNeedsRefresh(true);
      } else {
        setUnknown(true);
        setCanRetry(false);
      }
      setError((e as Error).message);
    } finally {
      finish();
    }
  }

  const status = pendingSave
    ? "保存结果未知"
    : problems.length
      ? `待完成：${problems[0]}`
      : changed
        ? "有未保存修改"
        : draft
          ? `已保存草稿 r${draft.draftRevision}`
          : "先选择规则目标";
  const footer = (
    <div className="traffic-drawer-footer">
      <span className="traffic-drawer-footer__status" aria-live="polite">
        {preview ? (unknown ? <span role="status">发布结果未知，请查询原提交。</span> : preview.change ? `确认后生效 v${preview.after.version}` : "与当前生效内容一致，无需发布") : status}
      </span>
      <Button disabled={locked} onClick={close}>
        关闭
      </Button>
      {preview ? (
        unknown ? (
          <>
            {canRetry && (
              <Button disabled={busy} onClick={() => void publish()}>
                使用原预览重试发布
              </Button>
            )}
            <Button type="primary" disabled={busy} onClick={() => void publish(true)}>
              查询原规则发布结果
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setError("");
              }}
            >
              取消发布
            </Button>
            <Button type="primary" disabled={busy || !preview.change} onClick={() => void publish()}>
              确认发布规则
            </Button>
          </>
        )
      ) : pendingSave ? (
        <Button type="primary" disabled={busy} onClick={() => void checkSave()}>
          核对草稿保存结果
        </Button>
      ) : phase === "target" ? (
        <DisabledReason reason={loading ? "正在读取规则" : !name.trim() ? "请先填写规则名称" : validation(name, bodyConfig).find((v) => /选择|租户/.test(v)) ?? ""}>
          <Button type="primary" disabled={loading || !name.trim() || validation(name, bodyConfig).some((v) => /选择|租户/.test(v))} onClick={() => setPhase("policy")}>
            下一步：配置策略
          </Button>
        </DisabledReason>
      ) : (
        <>
          {!draft && (
            <Button disabled={locked} onClick={() => setPhase("target")}>
              上一步：选择目标
            </Button>
          )}
          <DisabledReason reason={blockedReason || (draft && !changed ? "没有未保存的修改" : "")}>
            <Button disabled={Boolean(blockedReason) || (Boolean(draft) && !changed)} onClick={() => void save()}>
              保存规则草稿
            </Button>
          </DisabledReason>
          <DisabledReason reason={blockedReason}>
            <Button type="primary" disabled={Boolean(blockedReason)} onClick={() => void (changed || !draft ? save(true) : previewChange())}>
              {changed || !draft ? "保存并核对发布" : "核对发布差异"}
            </Button>
          </DisabledReason>
        </>
      )}
    </div>
  );

  const notices = (
    <>
      <ErrorFeedback error={error} />
      {message && <Alert closable type="success" showIcon title={message} />}
      {needsRefresh && !latest && !pendingSave && (
        <Alert
          type="warning"
          showIcon
          title="当前基线需要重新核对；你的输入仍保留。"
          action={
            <Button size="small" disabled={locked} onClick={() => void refreshCurrent()}>
              读取最新草稿
            </Button>
          }
        />
      )}
      {latest && (
        <section className="traffic-section" aria-label="草稿冲突核对">
          <h3>最新草稿 r{latest.draftRevision} 与本次输入</h3>
          <Comparison editingConflict beforeName={latest.name} before={latest.config} name={name} after={bodyConfig} />
          <div className="traffic-inline">
            <Button onClick={() => resolveConflict(true)}>保留输入，以最新修订继续编辑</Button>
            <Button onClick={() => resolveConflict(false)}>放弃输入，加载最新草稿</Button>
          </div>
        </section>
      )}
    </>
  );

  const editContent = (
    <div className="traffic-drawer-body">
      {notices}
      {draft && (
        <section className="traffic-section" aria-label="规则目标">
          <div className="traffic-inline">
            <h3>规则目标</h3>
            <FieldHelp label="目标固定">目标在创建后固定。不同目标请新增规则，避免把已有生效策略转移到其他对象。</FieldHelp>
          </div>
          <TargetFacts draft={draft} />
        </section>
      )}
      {!draft && phase === "policy" && (
        <section className="traffic-section" aria-label="规则目标">
          <TargetFacts draft={{ config, targetDisplay }} />
        </section>
      )}
      {!draft && <Steps size="small" current={phase === "target" ? 0 : 1} items={[{ title: "选择规则目标" }, { title: "配置策略与发布" }]} />}
      <label className="traffic-field">
        <FieldLabel label="规则名称" required />
        <Input
          aria-label="规则名称"
          maxLength={100}
          value={name}
          disabled={locked || Boolean(latest)}
          onChange={(e) => {
            setName(e.target.value);
            setMessage("");
          }}
          placeholder="例如：订单查询接入方保护"
        />
      </label>
      {!draft && phase === "target" ? (
        <TargetFields
          api={api}
          types={allowedTypes}
          config={config}
          onChange={(value) => {
            if (value.target.type !== config.target.type) setTargetDisplay({});
            setConfig(value);
          }}
          onDisplay={setTargetDisplay}
          display={targetDisplay}
        />
      ) : (
        <PolicyFields
          config={config}
          setConfig={(v) => {
            setConfig(v);
            setMessage("");
          }}
          ipText={ipText}
          setIpText={setIpText}
          disabled={locked || Boolean(latest)}
        />
      )}
      {problems.length > 0 && (
        <p className="op-cell-sub op-cell-sub--warning" role="status">
          待完成：{problems.join("；")}
        </p>
      )}
    </div>
  );

  const historyContent = (
    <div className="traffic-drawer-body">
      {notices}
      <section className="traffic-section" aria-label="规则版本记录">
        {changed && <p className="op-cell-sub op-cell-sub--warning">当前输入尚未保存；可查看历史，保存后再核对回滚。</p>}
        <Table<Release>
          size="small"
          rowKey="id"
          pagination={false}
          loading={busy && !history}
          dataSource={history?.items ?? []}
          columns={[
            {
              title: "发布版本 / 时间",
              render: (_, r) => (
                <div className="op-cell-main">
                  <span className="traffic-inline">
                    <strong className="op-code">v{r.rule.version}</strong>
                    {r.id === draft?.liveReleaseId && <StatusBadge tone="success">当前生效</StatusBadge>}
                  </span>
                  <span className="op-cell-sub">{r.name}</span>
                  <span className="op-cell-sub">
                    {new Date(r.publishedAt).toLocaleString("zh-CN", { hour12: false })}
                    {r.sourceReleaseId ? " · 回滚生成" : ""}
                  </span>
                </div>
              ),
            },
            { title: "状态", width: 140, render: (_, r) => <RuleState value={r.rule} /> },
            {
              title: "请求额度 / IP",
              render: (_, r) => (
                <div className="op-cell-main">
                  <span>{rateText(r.rule)}</span>
                  <span className="op-cell-sub">{quotaText(r.rule)}</span>
                  <span className="op-cell-sub" title={r.rule.ipAddresses.join("、") || undefined}>
                    {ipNames[r.rule.ipMode]}
                    {r.rule.ipAddresses.length > 0 && ` · ${r.rule.ipAddresses.length} 项`}
                  </span>
                </div>
              ),
            },
            {
              title: "操作",
              width: 130,
              render: (_, r) => (
                <Button type="link" size="small" disabled={locked || changed || needsRefresh || r.id === draft?.liveReleaseId} onClick={() => void previewChange(r.id)}>
                  核对回滚到此内容
                </Button>
              ),
            },
          ]}
        />
        {history && history.total > 20 && (
          <Pagination simple size="small" current={historyPage} pageSize={20} total={history.total} disabled={locked} onChange={(p) => void loadHistory(p)} />
        )}
      </section>
    </div>
  );

  const previewContent = preview && (
    <div className="traffic-drawer-body">
      {notices}
      <section className="traffic-section" aria-label="规则发布预览">
        <h3>{preview.sourceReleaseId ? "从历史创建新的规则版本" : "核对发布差异"}</h3>
        <p className="op-muted">
          固定草稿 r{preview.draftRevision} · 当前生效 v{preview.stateVersion} → 本次 v{preview.after.version}
          {preview.sourceReleaseId ? " · 回滚不覆盖工作草稿" : ""}
        </p>
        <Comparison beforeName={preview.beforeName} before={preview.before} name={preview.name} after={preview.after} />
        <div className="traffic-inline">
          <RuleState value={preview.after} />
          <span>
            {preview.after.enabled
              ? preview.after.mode === "ENFORCE"
                ? "本次发布后，超限或IP不匹配将拒绝调用。"
                : "本次规则只记录预计拒绝，不拦截请求。"
              : "本次发布后停止此规则的拦截，其他规则仍有效。"}
          </span>
          {preview.warnings.length > 0 && (
            <FieldHelp label="计数与影响">
              <ul className="traffic-warnings">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </FieldHelp>
          )}
        </div>
      </section>
    </div>
  );

  const ready = Boolean(draft) || ruleId === "new";
  return (
    <EntityDrawer
      open={Boolean(ruleId)}
      width="lg"
      title={draft ? draft.name : ruleId === "new" ? "新增规则" : "限流规则"}
      status={draft ? <RuleState value={draft.liveRule} /> : undefined}
      subtitle={
        draft ? (
          <span className="traffic-inline op-muted">
            <span>{draft.liveRule ? `生效 v${draft.liveRule.version}` : "尚未发布"}</span>
            <span>草稿 r{draft.draftRevision}</span>
            {changed ? <StatusBadge tone="warning">有未保存修改</StatusBadge> : <span>已保存</span>}
          </span>
        ) : undefined
      }
      actions={draft && overview ? overview(draft) : undefined}
      onClose={() => {
        if (!locked) close();
      }}
      footer={
        ready ? (
          footer
        ) : (
          <div className="traffic-drawer-footer">
            <Button onClick={close}>关闭</Button>
          </div>
        )
      }
      tabs={
        draft && !preview
          ? [
              { key: "edit", label: "规则配置", disabled: locked && tab !== "edit", children: editContent },
              { key: "history", label: "版本记录 / 回滚", disabled: locked && tab !== "history", children: historyContent },
            ]
          : undefined
      }
      activeTab={tab}
      onTabChange={(key) => {
        if (key === "history") void loadHistory();
        else {
          setTab("edit");
          setMessage("");
        }
      }}
    >
      {loading && <p role="status">正在读取规则…</p>}
      {!loading && ruleId && ruleId !== "new" && !draft && (
        <div className="traffic-drawer-body">
          {notices}
          <Button onClick={() => setReadRevision((value) => value + 1)}>重新读取规则</Button>
        </div>
      )}
      {ready && (preview ? previewContent : editContent)}
    </EntityDrawer>
  );
}
