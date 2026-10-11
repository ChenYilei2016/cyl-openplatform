import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import { useMemo } from 'react';
import { Alert, Button } from 'antd';
import DocumentExplorer from '@cyl/open-platform-web-shared/documentation/DocumentExplorer';
import { createDocumentClient } from '@cyl/open-platform-web-shared/documentation/api';
import type { PortalApplication, PortalSession } from './api';
import BusinessIdentity from './BusinessIdentity';
import PublishedInvocation from './PublishedInvocation';
import CustomerSdkAssets from '../sdk/CustomerSdkAssets';

export default function PortalConnection({
  application,
  session,
  employeeNo,
  initialSecret,
  onClearSecret,
  onChooseEmployee,
}: {
  application: PortalApplication;
  session: PortalSession;
  employeeNo?: string;
  initialSecret?: string;
  onClearSecret?: () => void;
  onChooseEmployee?: () => void;
}) {
  const active = application.status === 'ACTIVE' && application.applicationStatus === 'ENABLED';
  return (
    <section className="op-access-connection" aria-label="应用接入">
      <header className="op-access-connection__head">
        <div className="op-access-connection__title"><h2>准备调用身份</h2><span>{employeeNo ? `员工 ${employeeNo}` : '凭据自主调用'}</span></div>
        <div className="op-access-connection__actions">
          {onChooseEmployee && <Button onClick={onChooseEmployee}>选择调用员工</Button>}
          <a href="?section=documents">浏览公开文档 ↗</a>
        </div>
      </header>
      {!active ? (
        <Alert
          type="warning"
          showIcon
          title={
            application.applicationStatus === 'DISABLED'
              ? '凭据已停用，请联系维护者恢复后再获取Token。'
              : '本租户关联已解绑，请重新绑定后再获取Token。'
          }
        />
      ) : (
        <BusinessIdentity
          key={`${application.id}:${stringifyJson(application.authorizationVersion)}:${employeeNo ?? ''}`}
          initialMode="ak"
          initialSecret={initialSecret}
          onClearSecret={onClearSecret}
          constraint={{ tenantId: session.tenantId, applicationId: application.applicationId, appKey: application.appKey, employeeNo }}
          employeeRequired={!!employeeNo}
          renderAuthenticated={(token, onUnauthorized) => <AuthorizedDocuments token={token} onUnauthorized={onUnauthorized} />}
        />
      )}
    </section>
  );
}
function AuthorizedDocuments({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const client = useMemo(() => createDocumentClient({ token, onUnauthorized }), [token, onUnauthorized]);
  return (
    <div className="op-access-documents">
      <h2>可调用文档与验证</h2>
      <DocumentExplorer
        client={client}
        invocationLabel="调用此接口"
        renderInvocation={(view, refreshing) => (
          <>
            <PublishedInvocation key={view.releaseId} view={view} token={token} onUnauthorized={onUnauthorized} disabled={refreshing} />
            <details>
              <summary>此版本的客户端 SDK</summary>
              <CustomerSdkAssets key={view.releaseId} operation={view} token={token} onUnauthorized={onUnauthorized} />
            </details>
          </>
        )}
      />
    </div>
  );
}
