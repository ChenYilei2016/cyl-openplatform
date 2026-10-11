import { RightOutlined } from '@ant-design/icons';
import { IdText, StatusBadge, defineStatusMap } from '@cyl/open-platform-web-shared/ui/components';
import type { PortalApplication, PortalScope } from './api';

export const credentialStatus = defineStatusMap({
  ENABLED: { tone: 'success', label: '启用' },
  DISABLED: { tone: 'warning', label: '停用' },
});
export const relationStatus = defineStatusMap({
  ACTIVE: { tone: 'success', label: '已绑定' },
  REVOKED: { tone: 'neutral', label: '已解绑' },
});

/** 列表只显示一个综合状态：停用优先于解绑，两者都正常时为“已绑定”。 */
export function CredentialAvailability({ application }: { application: PortalApplication }) {
  if (application.applicationStatus === 'DISABLED') return <StatusBadge tone="warning">凭据停用</StatusBadge>;
  return <relationStatus.Badge value={application.status} />;
}

/** 权限组是凭据的已配置范围，不代替凭据/关联状态及接口调用授权判断。 */
export function CredentialScopes({ scopes, compact = false }: { scopes: PortalScope[]; compact?: boolean }) {
  if (!scopes.length) return <span className="op-muted">未分配权限组</span>;
  const tag = (scope: PortalScope) => <span key={scope.code} className={`op-credential-scope${scope.enabled ? '' : ' is-disabled'}`} title={`${scope.name} · ${scope.code}`}>
    <span className="op-credential-scope__name">{scope.name}</span>
    <code>{scope.code}</code>
    {!scope.enabled && <span className="op-credential-scope__disabled">停用</span>}
  </span>;
  return <div className="op-credential-scopes">
    {scopes.slice(0, compact ? 3 : scopes.length).map(tag)}
    {compact && scopes.length > 3 && <details className="op-credential-scopes__more" onClick={event => event.stopPropagation()}>
      <summary>另 {scopes.length - 3} 个权限组</summary>
      <div className="op-credential-scopes">{scopes.slice(3).map(tag)}</div>
    </details>}
  </div>;
}

/** 横向凭据列表行；详情沿用原抽屉，复制AK及展开权限组不会打开详情。 */
export default function CredentialRow({ application, onOpen }: { application: PortalApplication; onOpen: () => void }) {
  const usable = application.applicationStatus === 'ENABLED' && application.status === 'ACTIVE';
  const label = application.note || '未设置本租户备注';
  return <article role="listitem" className={`op-credential-row${usable ? '' : ' is-inactive'}`} onClick={onOpen}>
    <div className="op-credential-row__identity">
      <h3 className="op-credential-row__title">
        <button type="button" className={application.note ? undefined : 'op-muted'} title={label} aria-label={`查看 ${application.note || application.appKey} 详情`}>{label}</button>
      </h3>
      <IdText value={application.appKey} label="AK" maxChars={36} />
    </div>
    <div className="op-credential-row__scopes">
      <span className="op-credential-row__mobile-label">已授权权限组</span>
      <CredentialScopes scopes={application.scopes} compact />
    </div>
    <div className="op-credential-row__status"><CredentialAvailability application={application} /></div>
    <button type="button" className="op-credential-row__open" aria-label={`打开 ${application.note || application.appKey} 详情与操作`}>详情与操作 <RightOutlined aria-hidden /></button>
  </article>;
}
