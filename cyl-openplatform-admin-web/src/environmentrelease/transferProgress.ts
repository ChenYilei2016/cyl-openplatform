import { stringifyJson } from '@cyl/open-platform-web-shared/json';
import type { StatusTone } from '@cyl/open-platform-web-shared/ui/components';
import type { Receipt, Target, TransferSummary } from './types';

/** 发送结果：未确定（待确认、未知）都需要跟进，按警示显示。 */
export const deliveryTone: Record<TransferSummary['deliveryState'], StatusTone> = { READY: 'warning', ACCEPTED: 'success', UNKNOWN: 'warning', REJECTED: 'error' };
/** 目标独立开关：未取得回执时为中性。 */
export const accessTone = (enabled: boolean | undefined): StatusTone => (enabled === undefined ? 'neutral' : enabled ? 'success' : 'warning');

export const transferHelp = {
  purpose: ['其他环境发布记录是什么？', '例如订单 API 已在测试环境生效，希望预发也使用这份配置，就在 API 发布工作区申请发布到预发。本页分别查看目标接收、目标审核、目标配置、独立开关及各节点观测。'],
  send: ['发送和目标接收有什么不同？', '发送说明请求已发出；目标接收说明对方返回了本次申请的回执。没有回执时先查询原申请，不能推断失败或换编号重发。'],
  review: ['是否需要审核，由谁决定？', '目标开启审核时等待其审核人处理；目标免审时按目标规则直接生效。来源已通过不代替目标审核，来源不能自行选择免审。'],
  config: ['目标配置生效是什么意思？', '本次配置已生效表示目标运行指针指向本次发布。它不代表独立开关已打开，也不代表每个节点都已加载。'],
  enabled: ['目标独立开关是什么意思？', '启停独立于发布。即使配置已生效，停用的目标 API 仍不能调用。这里只读展示目标开关；启用后仍需通过调用权限与服务运行校验。'],
  nodes: ['什么时候能确认所有节点？', '必须取得完整、非空的目标节点配置，每个节点唯一观测到同一发布号、修订和开关。节点缺失、重复、不可达或仍是旧版本时不能全部确认；观测只代表标注时刻。'],
} as const;

type ProgressSource = Pick<TransferSummary, 'id' | 'sourceEnvironment' | 'targetId' | 'deliveryState' | 'receipt' | 'observations'>;

/** 将来源、回执和配置节点逐项核对，发送、审批、配置和开关分别表达。 */
export function transferProgress(transfer: ProgressSource, target?: Target) {
  const matches = (receipt: Receipt | null) => !!receipt && !!transfer.sourceEnvironment
    && receipt.sourceEnvironment === transfer.sourceEnvironment && receipt.environmentId === transfer.targetId && receipt.transferId === transfer.id;
  const receipt = matches(transfer.receipt) ? transfer.receipt! : null;
  const nodes = (target?.nodeIds ?? []).map(nodeId => {
    const entries = (transfer.observations ?? []).filter(item => item.nodeId === nodeId);
    const observation = entries.length === 1 ? entries[0] : null;
    const observed = observation && !observation.error && matches(observation.receipt) && observation.receipt?.nodeId === nodeId ? observation.receipt : null;
    return { nodeId, observation, receipt: observed, error: entries.length > 1 ? '节点观测重复，无法确认' : observation?.error || (!observed && observation?.receipt ? '回执与本次申请不匹配' : null) };
  });
  const configured = !!target && target.id === transfer.targetId && nodes.length > 0 && new Set(target.nodeIds).size === nodes.length;
  const applied = !!receipt && receipt.status === 'APPLIED' && receipt.liveReleaseId === receipt.releaseId;
  const complete = configured && applied && nodes.every(node => !!node.receipt && node.receipt.status === 'APPLIED'
    && node.receipt.releaseId === receipt.releaseId && node.receipt.liveReleaseId === receipt.releaseId
    && stringifyJson(node.receipt.draftRevision) === stringifyJson(receipt.draftRevision) && node.receipt.enabled === receipt.enabled);
  const observed = nodes.filter(node => !!node.receipt).length;
  return {
    receipt, nodes, complete, ready: complete && receipt?.enabled === true,
    delivery: { READY: '待确认发送', ACCEPTED: '目标已接收', UNKNOWN: '结果暂未知', REJECTED: '目标拒收' }[transfer.deliveryState],
    received: receipt ? '已取得目标回执' : '尚未取得匹配回执',
    review: !receipt ? '审核规则未知' : !receipt.auditRequired ? '无需审核' : receipt.status === 'PENDING' ? '待目标审核' : receipt.status === 'APPLIED' ? '目标审核通过' : receipt.status === 'REJECTED' ? '目标已驳回' : '审核后生效失败',
    config: !receipt ? '配置结果未知' : receipt.status === 'FAILED' ? '本次生效失败' : applied ? '本次配置已生效' : receipt.liveReleaseId ? '仍为旧版本' : '尚无生效配置',
    access: !receipt ? '开关未知' : receipt.enabled ? '启用' : '停用',
    observation: !configured ? '节点集合未知' : complete ? receipt?.enabled ? '全部节点配置与开关一致' : '全部节点已加载 · 当前停用' : `已观察 ${observed}/${nodes.length} · 尚未全部确认`,
  };
}
