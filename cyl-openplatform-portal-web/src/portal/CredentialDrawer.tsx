import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import type { ApiClient } from '@cyl/open-platform-web-shared/http';
import { ErrorFeedback } from '@cyl/open-platform-web-shared/components';
import { EntityDrawer, FieldHelp, IdText, TenantTag } from '@cyl/open-platform-web-shared/ui/components';
import { Alert, Button, Tabs } from 'antd';
import { ApiOutlined, ReloadOutlined, RightOutlined, TeamOutlined } from '@ant-design/icons';
import type { PortalApplication, PortalSession } from './api';
import { CredentialAvailability, CredentialScopes, credentialStatus, relationStatus } from './CredentialRow';
import PortalConnection from './PortalConnection';
import PortalDelegations from './PortalDelegations';

export type CredentialTab = 'overview' | 'token' | 'employees';

export function readCredentialTab(value: string | null): CredentialTab {
  return value === 'token' || value === 'employees' ? value : 'overview';
}

/**
 * 本租户凭据详情抽屉：结构对齐管理端凭据抽屉，只含本租户能力（概览、Token 与调用、调用员工）。
 * 页签内容首次打开后保持挂载，切换页签不丢输入；关闭抽屉即卸载，Secret 与 Token 随之清除。
 */
export default function CredentialDrawer({
  application, session, api, loading, error, onRetry, tab, onTabChange, onClose, locked, delegationBusy, refreshing,
  notice, employeeNo, handoffSecret, onClearSecret, onEditNote, onRevoke, onRebind, onDelegationBusy, onToken,
}: {
  application: PortalApplication | null;
  session: PortalSession;
  api: ApiClient;
  loading: boolean;
  error: string;
  onRetry: () => void;
  tab: CredentialTab;
  onTabChange: (tab: CredentialTab) => void;
  onClose: () => void;
  locked: boolean;
  delegationBusy: boolean;
  refreshing: boolean;
  notice: string;
  employeeNo?: string;
  handoffSecret: string;
  onClearSecret: () => void;
  onEditNote: () => void;
  onRevoke: () => void;
  onRebind: () => void;
  onDelegationBusy: (busy: boolean) => void;
  onToken: (employeeNo: string) => void;
}) {
  return (
    <EntityDrawer
      open
      width="lg"
      title={application?.note || '接入凭据'}
      status={application && <CredentialAvailability application={application} />}
      subtitle={application && <IdText value={application.appKey} label="AK" maxChars={40} />}
      onClose={onClose}
      loading={loading && !application}
      actions={<Button icon={<ReloadOutlined aria-hidden />} aria-label="刷新关联状态" title="刷新关联状态" disabled={locked || refreshing} onClick={onRetry} />}
    >
      <div className="op-access-drawer" aria-label="凭据接入详情">
        {error && !application && (
          <div className="op-access-drawer__error">
            <ErrorFeedback error={error} />
            <Button onClick={onRetry}>重新读取</Button>
          </div>
        )}
        {notice && <p role="status" className="op-access-notice">{notice}</p>}
        {application && (
          <Tabs
            className="op-drawer__tabs"
            activeKey={tab}
            onChange={(value) => onTabChange(readCredentialTab(value))}
            items={[
              {
                key: 'overview',
                label: '概览',
                children: (
                  <section className="op-access-overview" aria-label="凭据概览" inert={refreshing}>
                    {application.applicationStatus === 'DISABLED' ? (
                      <Alert type="warning" showIcon title="凭据已停用：不能换取或使用 Token，请联系平台维护者恢复。" />
                    ) : application.status !== 'ACTIVE' && (
                      <Alert type="info" showIcon title="本租户关联已解绑：旧 Token 已失效，重新绑定后需重新获取 Token。" />
                    )}
                    <dl className="op-access-facts">
                      <div><dt>AK</dt><dd><IdText value={application.appKey} label="AK" maxChars={40} /></dd></div>
                      <div><dt>凭据状态</dt><dd><credentialStatus.Badge value={application.applicationStatus} /></dd></div>
                      <div><dt>本租户关联</dt><dd><relationStatus.Badge value={application.status} /></dd></div>
                      <div><dt>当前租户</dt><dd><TenantTag name={session.tenantName} id={session.tenantId} /></dd></div>
                      <div>
                        <dt>本租户备注 <FieldHelp label="本租户备注">仅本租户可见，用来区分本租户的各个凭据。不会改变权限或已有 Token。</FieldHelp></dt>
                        <dd className="op-access-facts__note">
                          {application.note ? <span>{application.note}</span> : <span className="op-muted">未设置</span>}
                          <Button type="link" size="small" disabled={locked || application.status !== 'ACTIVE'} onClick={onEditNote}>编辑备注</Button>
                        </dd>
                      </div>
                    </dl>
                    <section aria-label="凭据已授权权限组" className="op-access-scopes">
                      <h3>已授权权限组</h3>
                      <CredentialScopes scopes={application.scopes} />
                      <p className="op-access-help">由平台管理员配置；停用权限组不可使用，调用还需凭据及本租户关联保持有效。</p>
                    </section>
                    <div className="op-access-next">
                      <button type="button" className="op-access-next__item" disabled={delegationBusy} onClick={() => onTabChange('token')}>
                        <ApiOutlined aria-hidden />
                        <span><strong>准备调用身份</strong><small>用 AK / Secret 或已有 Token 换取并验证业务 Token，再浏览可调用文档。</small></span>
                        <RightOutlined aria-hidden />
                      </button>
                      <button type="button" className="op-access-next__item" onClick={() => onTabChange('employees')}>
                        <TeamOutlined aria-hidden />
                        <span><strong>配置调用员工</strong><small>为本租户员工建立委托，之后可申请代表该员工的人员 Token。</small></span>
                        <RightOutlined aria-hidden />
                      </button>
                    </div>
                    <section className="op-access-danger" aria-label="本租户关联">
                      {application.status === 'ACTIVE' ? (
                        <>
                          <div>
                            <strong>解除本租户关联</strong>
                            <p>此租户关系及其人员授权派生的已有 Token 将失效；其他租户不受影响。</p>
                          </div>
                          <Button danger disabled={locked} onClick={onRevoke}>解绑本租户</Button>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>重新绑定本租户</strong>
                            <p>需要团队提供的配套 Secret；重新绑定不会恢复已撤销的旧 Token。</p>
                          </div>
                          <Button disabled={locked || application.applicationStatus !== 'ENABLED'} onClick={onRebind}>重新绑定</Button>
                        </>
                      )}
                    </section>
                    <p className="op-access-footnote">本租户关联 ID <IdText value={application.id} label="关联 ID" maxChars={36} /> · 其他租户关系不在门户返回或展示。</p>
                  </section>
                ),
              },
              {
                key: 'token',
                label: 'Token 与调用',
                disabled: delegationBusy,
                children: (
                  <div className="op-access-pane" inert={refreshing || delegationBusy}>
                    <PortalConnection
                      key={`${application.id}:${stringifyJson(application.authorizationVersion)}`}
                      application={application}
                      session={session}
                      employeeNo={employeeNo}
                      initialSecret={handoffSecret}
                      onClearSecret={onClearSecret}
                      onChooseEmployee={() => onTabChange('employees')}
                    />
                  </div>
                ),
              },
              {
                key: 'employees',
                label: '调用员工',
                children: (
                  <div className="op-access-pane" inert={refreshing}>
                    <PortalDelegations key={application.id} api={api} application={application} session={session} onBusy={onDelegationBusy} onToken={onToken} />
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </EntityDrawer>
  );
}
