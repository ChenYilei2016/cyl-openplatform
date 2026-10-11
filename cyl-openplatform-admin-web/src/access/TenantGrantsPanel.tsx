import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Table } from "antd";
import { useAdminNavigation } from "../navigation/AdminNavigation";
import {
  AdminApiError,
  type AdminApi,
  type Application,
  type TenantGrant,
} from "./api";
import { ErrorFeedback, LoadFeedback } from "@cyl/open-platform-web-shared/components";
import { useReadPage } from "@cyl/open-platform-web-shared/ui/useReadPage";
import {
  ConfirmAction,
  EmptyState,
  FieldHelp,
  FieldLabel,
  FormSection,
  IdText,
  TenantTag,
} from "@cyl/open-platform-web-shared/ui/components";
import { grantStatus } from "./credentialModel";
import UserGrantsPanel, { type PersonnelEditState } from "./UserGrantsPanel";
import { useManagementFilters } from "../navigation/useManagementFilters";
import type { TenantEditState } from "./ApplicationDetail";

export default function TenantGrantsPanel({
  api,
  application,
  initialGrantId,
  onEditState,
  onRelationshipsChanged,
  active = true,
  disabled = false,
}: {
  api: AdminApi;
  application: Application;
  initialGrantId?: string | null;
  onEditState?: (state: TenantEditState) => void;
  onRelationshipsChanged?: () => Promise<void>;
  active?: boolean;
  disabled?: boolean;
}) {
  const { page, filters, setFilters, applied, apply, reset, onPage } =
    useManagementFilters("tenantRelations", { tenantId: "" });
  const [revision, setRevision] = useState(0),
    [binding, setBinding] = useState(false),
    [tenantId, setTenantId] = useState(""),
    [secret, setSecret] = useState("");
  const [selected, setSelected] = useState<TenantGrant | null>(null);
  const [editing, setEditing] = useState<TenantGrant | null>(null),
    [note, setNote] = useState(""),
    [noteConflict, setNoteConflict] = useState(false);
  const [working, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [personnel, setPersonnel] = useState<PersonnelEditState>({ dirty: false, busy: false });
  const receivePersonnel = useCallback((state: PersonnelEditState) => setPersonnel(state), []);
  const personnelBusy = personnel.busy;
  const busy = working || disabled || personnelBusy;
  const navigation = useAdminNavigation(),
    writing = useRef(false);
  const [detailRetry, setDetailRetry] = useState(0),
    [detailError, setDetailError] = useState(""),
    [detailLoading, setDetailLoading] = useState(false);
  const path = `/applications/${encodeURIComponent(application.id)}/tenant-grants`;
  useEffect(() => {
    if (!active) setMessage("");
  }, [active]);
  useEffect(() => {
    setSelected((current) => (current?.id === initialGrantId ? current : null));
    setDetailError("");
    setDetailLoading(Boolean(initialGrantId));
    if (!initialGrantId) return;
    const controller = new AbortController();
    void api<TenantGrant>(`${path}/${encodeURIComponent(initialGrantId)}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setSelected(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setDetailError((failure as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [api, path, initialGrantId, detailRetry, revision]);
  const list = useReadPage<TenantGrant>(
    api,
    `${path}?page=${page}&pageSize=20${applied.tenantId.trim() ? `&tenantId=${encodeURIComponent(applied.tenantId.trim())}` : ""}`,
    revision,
    active,
  );
  const noteDirty = Boolean(editing && note !== editing.note),
    bindingDirty = binding && Boolean(tenantId || secret);
  const saveNote = async () => {
    if (!editing || writing.current || noteConflict) return false;
    writing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api<TenantGrant>(`${path}/${encodeURIComponent(editing.id)}/note`, {
        method: "PUT",
        body: {
          note: note.trim(),
          expectedRevision: editing.noteRevision ?? 0,
        },
      });
      setEditing(null);
      setNote("");
      setRevision((value) => value + 1);
      setMessage("本租户备注已保存，授权保持不变。");
      return true;
    } catch (failure) {
      setNoteConflict(
        failure instanceof AdminApiError &&
          (failure.code === 409 || Math.floor(failure.code / 100000) === 409),
      );
      setError((failure as Error).message);
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  const bind = async () => {
    if (writing.current || !tenantId.trim() || !secret) {
      setError("请填写目标租户ID和当前有效AppSecret。");
      return false;
    }
    writing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api<TenantGrant>("/tenant-grants", {
        method: "POST",
        body: {
          appKey: application.appKey,
          appSecret: secret,
          tenantId: tenantId.trim(),
        },
      });
      setBinding(false);
      setSecret("");
      setTenantId("");
      setRevision((value) => value + 1);
      setMessage("租户已绑定。");
      await onRelationshipsChanged?.();
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  const revoke = async (grant: TenantGrant) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api<null>(`/tenant-grants/${encodeURIComponent(grant.id)}`, { method: "DELETE" });
      setSelected(null);
      setRevision((value) => value + 1);
      setMessage("租户关联已撤销。");
      await onRelationshipsChanged?.();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  const finishNote = () => {
    if (noteDirty && !window.confirm("放弃未保存备注并切换查询？"))
      return false;
    setEditing(null);
    setNoteConflict(false);
    return true;
  };
  const saveRef = useRef(async () => true);
  saveRef.current = async () => {
    if (noteDirty && !(await saveNote())) return false;
    if (bindingDirty && !(await bind())) return false;
    return true;
  };
  useEffect(() => {
    onEditState?.({
      dirty: noteDirty || bindingDirty || personnel.dirty,
      personnelDirty: personnel.dirty,
      busy: working || personnelBusy,
      save: () => saveRef.current(),
    });
  }, [onEditState, noteDirty, bindingDirty, working, personnelBusy, personnel.dirty]);
  return (
    <section className="credential-section" aria-label="租户关联">
      <div className="credential-section" hidden={Boolean(initialGrantId)}>
        <div className="credential-section__head">
          <h2>租户关联</h2>
          <FieldHelp label="租户关联">
            同一凭据可以关联多个租户。解绑只撤销指定租户及其人员授权；其他租户不受影响。备注只属于该租户，不更改凭据全局名称。
          </FieldHelp>
          <div className="credential-section__actions">
            <Button
              type="primary"
              disabled={busy || application.status !== "ENABLED"}
              onClick={() => {
                setBinding(true);
                setMessage("");
                setError("");
              }}
            >
              绑定租户
            </Button>
          </div>
        </div>
        <ErrorFeedback error={error} />
        {message && (
          <p className="credential-notice" role="status">
            {message}
          </p>
        )}
        {binding && (
          <form
            className="credential-bind"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void bind();
            }}
          >
            <FormSection title="绑定租户" description="使用当前有效 AppSecret 校验；凭据已由当前页面确定，无需重复输入 AK。" stacked>
              <div>
                <FieldLabel label="目标租户 ID" required />
                <Input
                  aria-label="目标租户 ID"
                  required
                  maxLength={64}
                  value={tenantId}
                  disabled={busy}
                  onChange={(event) => setTenantId(event.target.value)}
                />
                <Button
                  type="link"
                  size="small"
                  className="credential-bind__owner"
                  disabled={busy}
                  onClick={() => setTenantId(application.ownerTenantId)}
                >
                  填入归属租户
                </Button>
              </div>
              <div>
                <FieldLabel label="应用 AppSecret" required />
                <Input.Password
                  aria-label="应用 AppSecret"
                  required
                  maxLength={128}
                  autoComplete="off"
                  value={secret}
                  disabled={busy}
                  onChange={(event) => setSecret(event.target.value)}
                />
              </div>
              <div className="credential-bind__actions">
                <Button type="primary" htmlType="submit" disabled={busy}>
                  校验并绑定
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setBinding(false);
                    setTenantId("");
                    setSecret("");
                    setError("");
                  }}
                >
                  取消绑定
                </Button>
              </div>
            </FormSection>
          </form>
        )}
        <form
          className="credential-query"
          onSubmit={(event) => {
            event.preventDefault();
            if (finishNote()) apply();
          }}
        >
          <label>
            <FieldLabel label="租户编号（精确）" />
            <Input
              aria-label="租户编号（精确）"
              maxLength={64}
              value={filters.tenantId}
              onChange={(event) => setFilters({ tenantId: event.target.value })}
            />
          </label>
          <Button htmlType="submit" disabled={busy}>
            查询租户
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (finishNote()) reset();
            }}
          >
            重置
          </Button>
        </form>
        <LoadFeedback {...list} retry={list.reload} />
        {list.data && (
          <Table<TenantGrant>
            locale={{
              emptyText: applied.tenantId ? (
                <EmptyState kind="noResult" title="该租户暂无关联" description="请调整编号或重置筛选。" />
              ) : (
                <EmptyState title="尚未关联租户" description="当前凭据没有租户调用授权；点击“绑定租户”开始。" />
              ),
            }}
            size="small"
            rowKey="id"
            dataSource={list.data.items}
            pagination={{
              current: page,
              pageSize: 20,
              total: list.data.total,
              showSizeChanger: false,
              size: "small",
              disabled: busy,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (value) => {
                if (finishNote()) onPage(value);
              },
            }}
            columns={[
              {
                title: "租户",
                width: "32%",
                render: (_, grant) => (
                  <div className="op-cell-main">
                    <TenantTag id={grant.tenantId} name={grant.tenantName} />
                    {grant.tenantName && (
                      <span className="op-cell-sub">
                        <IdText value={grant.tenantId} label="租户 ID" maxChars={24} />
                      </span>
                    )}
                  </div>
                ),
              },
              {
                title: "本租户备注",
                render: (_, grant) =>
                  editing?.id === grant.id ? (
                    <div className="credential-note-edit">
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveNote();
                        }}
                      >
                        <Input
                          aria-label={`本租户备注 ${grant.tenantId}`}
                          className="credential-note-edit__input"
                          autoFocus
                          value={note}
                          maxLength={100}
                          disabled={busy}
                          onChange={(event) => setNote(event.target.value)}
                        />
                        <Button type="primary" htmlType="submit" disabled={busy || noteConflict}>
                          保存备注
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setEditing(null);
                            setNoteConflict(false);
                            setError("");
                          }}
                        >
                          取消
                        </Button>
                      </form>
                      {noteConflict && (
                        <div className="credential-pending" role="status">
                          <span>备注已变化；输入保留。</span>
                          <Button
                            size="small"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                const latest = await api<TenantGrant>(`${path}/${encodeURIComponent(grant.id)}`);
                                setEditing(latest);
                                setNoteConflict(false);
                                setError("");
                                setMessage(`最新备注：${latest.note || "无"}。当前输入保留，请核对后保存。`);
                              } catch (failure) {
                                setError((failure as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            读取最新备注并保留输入
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="credential-note">
                      <span className={grant.note ? undefined : "op-muted"}>{grant.note || "未填写"}</span>
                      <Button
                        type="link"
                        size="small"
                        disabled={busy || grant.status !== "ACTIVE"}
                        onClick={() => {
                          if (editing && noteDirty && !window.confirm("放弃当前未保存备注并编辑另一租户？")) return;
                          setEditing(grant);
                          setNote(grant.note ?? "");
                          setNoteConflict(false);
                          setError("");
                          setMessage("");
                        }}
                      >
                        编辑备注
                        <span className="sr-only"> {grant.tenantId}</span>
                      </Button>
                    </div>
                  ),
              },
              {
                title: "关联状态",
                width: 100,
                render: (_, grant) => <grantStatus.Badge value={grant.status} />,
              },
              {
                title: "操作",
                width: 160,
                render: (_, grant) => {
                  const revokeBlocked = busy || noteDirty || bindingDirty || grant.status !== "ACTIVE";
                  return (
                    <div className="op-row-actions">
                      <Button
                        type="link"
                        size="small"
                        disabled={busy}
                        onClick={() => navigation.navigate({ ...navigation.route, tenantGrantId: grant.id })}
                      >
                        管理人员<span className="sr-only"> {grant.tenantId}</span>
                      </Button>
                      <ConfirmAction
                        title="解绑租户？"
                        description={`解除凭据「${application.name}」与租户 ${grant.tenantName ? `${grant.tenantName}（${grant.tenantId}）` : grant.tenantId} 的关联，该租户人员授权同时停止生效，其他租户不受影响。`}
                        okText="确认解绑"
                        danger
                        disabled={revokeBlocked}
                        onConfirm={() => revoke(grant)}
                      >
                        <Button type="link" size="small" danger disabled={revokeBlocked}>
                          解绑<span className="sr-only"> {grant.tenantId}</span>
                        </Button>
                      </ConfirmAction>
                    </div>
                  );
                },
              },
            ]}
          />
        )}
      </div>
      <LoadFeedback
        loading={detailLoading}
        error={detailError}
        retry={() => setDetailRetry((value) => value + 1)}
      />
      {initialGrantId && detailError && (
        <Button onClick={() => navigation.navigate({ ...navigation.route, tenantGrantId: null })}>
          返回租户关联
        </Button>
      )}
      {selected?.id === initialGrantId && selected && (
        <UserGrantsPanel
          key={selected.id}
          api={api}
          grant={selected}
          applicationEnabled={application.status === "ENABLED"}
          onEditState={receivePersonnel}
          onClose={() => navigation.navigate({ ...navigation.route, tenantGrantId: null })}
        />
      )}
    </section>
  );
}
