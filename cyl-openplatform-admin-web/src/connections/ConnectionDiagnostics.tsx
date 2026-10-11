import { StatusBadge, type StatusTone } from '@cyl/open-platform-web-shared/ui/components';
import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import type { CheckStatus, Diagnostics } from './types';

export const discoveryNames = { INTERFACE: '接口级发现', APPLICATION: '应用级发现' };
export const metadataNames = { NONE: '不使用', NACOS: 'Nacos', REDIS: 'Redis' };
const statusNames: Record<CheckStatus, string> = { PASSED: '通过', FAILED: '失败', UNAVAILABLE: '未完成', NOT_APPLICABLE: '不适用', NOT_CHECKED: '未检查' };
const statusTones: Record<CheckStatus, StatusTone> = { PASSED: 'success', FAILED: 'error', UNAVAILABLE: 'warning', NOT_APPLICABLE: 'neutral', NOT_CHECKED: 'neutral' };
const stageNames = { CONFIG: '注册中心配置与账号引用', REGISTRY: '地址、认证与namespace/group读取', INSTANCES: '健康实例', MAPPING: '接口到应用映射', RUNTIME_METADATA: '运行元数据', DEFINITION: '业务接口与方法' };

export function CheckTag({ status }: { status: CheckStatus }) {
  return <StatusBadge tone={statusTones[status] ?? 'neutral'}>{statusNames[status] ?? status}</StatusBadge>;
}
export function registryCheckLabel(check?: Diagnostics | null, revision?: number | null): string {
  if (!check) return '本实例暂无检查记录';
  const registry = check.checks.find(value => value.stage === 'REGISTRY');
  const status = registry?.status ?? 'NOT_CHECKED';
  const label = status === 'PASSED' ? '注册中心可访问' : status === 'FAILED' ? '检查失败' : status === 'UNAVAILABLE' ? '检查未完成' : '未检查注册中心';
  const detail = `r${stringifyJson(check.revision)} ${label}`;
  return revision != null && stringifyJson(revision) !== stringifyJson(check.revision) ? `该修订检查状态未知；本实例最近${detail}` : detail;
}
/** 最近一次注册中心检查：状态圆点 + 结论，下一行为检查时间；检查的修订与当前修订不同时以中性显示。 */
export function RegistryCheck({ check, revision }: { check?: Diagnostics | null; revision?: number | null }) {
  const status = check?.checks.find(value => value.stage === 'REGISTRY')?.status ?? 'NOT_CHECKED';
  const stale = check != null && revision != null && stringifyJson(revision) !== stringifyJson(check.revision);
  return <span className="op-cell-main">
    <StatusBadge tone={!check || stale ? 'neutral' : statusTones[status]}>{registryCheckLabel(check, revision)}</StatusBadge>
    {check && <span className="op-cell-sub">{check.checkedAt}</span>}
  </span>;
}
export default function ConnectionDiagnostics({ result }: { result: Diagnostics }) {
  const verified = result.checks.filter(value => value.stage === 'CONFIG' || value.stage === 'REGISTRY');
  const notChecked = result.checks.filter(value => value.stage !== 'CONFIG' && value.stage !== 'REGISTRY');
  const group = (title: string, items: Diagnostics['checks']) => <div><h4>{title}</h4><ul>{items.map(value => <li key={value.stage}>
    <CheckTag status={value.status} /><div><strong>{stageNames[value.stage]}</strong><p>{value.summary}</p></div>
  </li>)}</ul></div>;
  return <section className="connection-diagnostics" aria-label="注册中心检查结果">
    <div className="connection-section-heading"><h3>检查结果</h3><span>已保存 r{stringifyJson(result.revision)} · {result.checkedAt}</span></div>
    <div className="connection-check-columns">
      {group('本次已验证', verified)}
      {group('不在本次检查范围', notChecked)}
    </div>
    <p className="connection-hint">注册中心可访问不表示业务接口可调用；实例、接口签名和提供方认证由显式业务测试确认。</p>
  </section>;
}
