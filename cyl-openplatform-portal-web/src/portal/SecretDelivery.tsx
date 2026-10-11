import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox } from 'antd';
import { CheckOutlined, CopyOutlined, WarningFilled } from '@ant-design/icons';
import { TenantTag } from '@cyl/open-platform-web-shared/ui/components';
import type { PortalSession } from './api';

type Copied = 'AK' | 'Secret' | 'failed' | null;

/**
 * 一次性 Secret 交付：醒目提示不可再次查看，复制后给出确认，勾选“已保存”后才能关闭或继续。
 * Secret 只经由 props 停留在内存，不写入地址、存储或日志。
 */
export default function SecretDelivery({ session, appKey, appSecret, saved, onSavedChange }: {
  session: PortalSession;
  appKey: string;
  appSecret: string;
  saved: boolean;
  onSavedChange: (value: boolean) => void;
}) {
  const [copied, setCopied] = useState<Copied>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const copy = async (value: string, label: 'AK' | 'Secret') => {
    try {
      await navigator.clipboard.writeText(value);
      if (alive.current) setCopied(label);
    } catch {
      if (alive.current) setCopied('failed');
    }
  };
  return (
    <div className="op-secret">
      <div className="op-secret__warning" role="note">
        <WarningFilled aria-hidden />
        <div>
          <strong>Secret 只显示这一次，关闭后无法再次查看</strong>
          <p>平台不保存可找回的 Secret。请立即复制并交给负责接入的人员安全保存；刷新、切换页面或关闭后都无法恢复。</p>
        </div>
      </div>
      <p className="op-secret__context">当前租户 <TenantTag name={session.tenantName} id={session.tenantId} /> · 已绑定 · 创建时的默认权限已分配。</p>
      <dl className="op-secret__values">
        <div>
          <dt>AppKey</dt>
          <dd>
            <code>{appKey}</code>
            <Button size="small" icon={copied === 'AK' ? <CheckOutlined aria-hidden /> : <CopyOutlined aria-hidden />} onClick={() => void copy(appKey, 'AK')}>
              {copied === 'AK' ? '已复制 AK' : '复制 AK'}
            </Button>
          </dd>
        </div>
        <div>
          <dt>本次 AppSecret</dt>
          <dd>
            <code data-testid="created-secret" className="op-secret__value">{appSecret}</code>
            <Button type="primary" size="small" icon={copied === 'Secret' ? <CheckOutlined aria-hidden /> : <CopyOutlined aria-hidden />} onClick={() => void copy(appSecret, 'Secret')}>
              {copied === 'Secret' ? '已复制 Secret' : '复制 Secret'}
            </Button>
          </dd>
        </div>
      </dl>
      <p role="status" className={`op-secret__copied${copied === 'failed' ? ' is-error' : ''}`}>
        {copied === 'failed' ? '复制失败，请手动选中 Secret 并复制。' : copied ? `${copied} 已复制，请粘贴到安全位置保存。` : ''}
      </p>
      <Checkbox checked={saved} onChange={(event) => onSavedChange(event.target.checked)}>
        我已安全保存本次 Secret，理解关闭后无法再次查看
      </Checkbox>
    </div>
  );
}
