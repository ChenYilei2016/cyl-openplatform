export interface ApiLifecycle {
  status: 'ACTIVE' | 'DEPRECATED' | 'RETIRED';
  compatibility: 'UNSPECIFIED' | 'COMPATIBLE' | 'BREAKING';
  compatibilityNotes: string;
  deprecationNotice: string;
  replacementVersion: string | null;
  sunsetDate: string | null;
}

export const defaultLifecycle: ApiLifecycle = { status: 'ACTIVE', compatibility: 'UNSPECIFIED', compatibilityNotes: '', deprecationNotice: '', replacementVersion: null, sunsetDate: null };
export const lifecycleStatusNames = { ACTIVE: '正常服务', DEPRECATED: '已废弃（仍可调用）', RETIRED: '已退出（调用返回 410）' };
export const compatibilityNames = { UNSPECIFIED: '未声明', COMPATIBLE: '兼容变更', BREAKING: '不兼容变更' };

export default function LifecycleDetails({ lifecycle = defaultLifecycle }: { lifecycle?: ApiLifecycle | null }) {
  const value = lifecycle ?? defaultLifecycle;
  // 维护者填写的说明保留换行并允许长词断行。
  return <div className="detail-section lifecycle-details" aria-label="生命周期说明" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
    <p><strong>生命周期：{lifecycleStatusNames[value.status]}</strong></p>
    <p>兼容性声明：{compatibilityNames[value.compatibility]}（维护者声明，未经自动兼容性证明）</p>
    {value.compatibilityNotes && <p>兼容性说明：{value.compatibilityNotes}</p>}
    {value.deprecationNotice && <p>废弃说明：{value.deprecationNotice}</p>}
    {value.replacementVersion && <p>替代外部版本：{value.replacementVersion}（仅迁移提示，不自动跳转或授权）</p>}
    {value.sunsetDate && <p>计划退出日期：{value.sunsetDate}（仅计划说明，到期不会自动退出）</p>}
    <p className="help-text">生命周期随发布快照生效，独立启停开关仍然适用。</p>
  </div>;
}
