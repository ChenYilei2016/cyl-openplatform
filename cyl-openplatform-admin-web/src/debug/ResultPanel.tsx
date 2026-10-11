import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from "@ant-design/icons";
import { Button, Tabs } from "antd";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { CopyButton, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { responseIssueText } from "../catalog/ResponseAdapterEditor";
import type { DebugContent, DebugResult } from "./types";

export const stages: Record<string, string> = {
  AUTHORIZATION: "身份与权限",
  REQUEST: "请求与映射",
  TARGET: "提供方目标",
  PROVIDER_AUTH: "提供方验证",
  PROVIDER_CALL: "提供方调用",
  BUSINESS: "业务结果",
  ADAPT: "数据提取",
  SCHEMA: "公开结构",
};
const statuses = { PASSED: "通过", FAILED: "需处理", NOT_CHECKED: "未执行", UNAVAILABLE: "待调用确认" };
export const resultTabs = {
  publicResponse: "最终对外响应",
  providerResponse: "提供方原始返回",
  adaptedData: "提取的业务数据",
  mappedInput: "实际提供方参数",
} as const;
export type ResultTab = keyof typeof resultTabs;

/** 执行后先看哪一栏：成功看对外响应；结构问题看提取数据；其他失败看提供方原始返回。 */
export function initialTab(result: DebugResult, kind: "preflight" | "execute"): ResultTab {
  if (kind === "preflight") return "mappedInput";
  if (result.outcome === "SUCCEEDED") return "publicResponse";
  if (result.checks.some((check) => check.stage === "SCHEMA" && check.status === "FAILED") && result.adaptedData.available) return "adaptedData";
  return result.providerResponse.available ? "providerResponse" : "publicResponse";
}

type Tone = "success" | "error" | "warning" | "info";
/** 结论：调用成功 / 业务失败 / 调用失败 / 结果未知；预检另有两种。 */
function conclusion(result: DebugResult, kind: "preflight" | "execute"): { tone: Tone; title: string; reason?: string } {
  const failed = result.checks.filter((check) => check.status === "FAILED");
  const first = failed[0];
  const reason = first ? `${stages[first.stage] ?? first.stage}：${first.summary}` : undefined;
  if (kind === "preflight")
    return result.outcome === "SUCCEEDED" ? { tone: "info", title: "预检通过 · 尚未执行业务" } : { tone: "warning", title: "预检发现问题", reason };
  if (result.outcome === "SUCCEEDED") return { tone: "success", title: "调用成功" };
  if (result.outcome === "UNKNOWN") return { tone: "warning", title: "结果未知", reason: reason ?? "提供方是否执行无法确认，请按请求号核对后再决定是否重试" };
  if (failed.some((check) => check.stage === "BUSINESS"))
    return { tone: "error", title: "业务失败", reason: result.providerMessage ? `提供方消息：${result.providerMessage.value}` : reason };
  return { tone: "error", title: "调用失败", reason };
}
const icons = { success: <CheckCircleFilled />, error: <CloseCircleFilled />, warning: <ExclamationCircleFilled />, info: <InfoCircleFilled /> };

export default function ResultPanel({
  result,
  kind,
  tab,
  onTab,
  placeholder,
  onCheckIdentity,
  onCheckRequest,
  onConfigureTarget,
  onRepair,
  onUseExample,
}: {
  result: DebugResult | null;
  kind: "preflight" | "execute";
  tab: ResultTab;
  onTab: (tab: ResultTab) => void;
  placeholder: string;
  onCheckIdentity: () => void;
  onCheckRequest: () => void;
  onConfigureTarget?: () => void;
  onRepair?: (repairsStructure: boolean) => void;
  onUseExample?: (data: unknown) => void;
}) {
  if (!result)
    return (
      <div className="op-debug-result__empty">
        <strong>{placeholder}</strong>
        <p>结果先给结论，再给原始响应、耗时与提供方请求。需要提前排查时用“检查准备情况”，预检不会发送业务。</p>
      </div>
    );
  const verdict = conclusion(result, kind);
  const failed = result.checks.filter((check) => check.status === "FAILED");
  const selected: DebugContent | undefined = result[tab];
  const businessData = result.publicResponse.available ? (result.publicResponse.value as { data?: unknown })?.data : undefined;
  const repairable = failed.some((check) => ["BUSINESS", "ADAPT", "SCHEMA"].includes(check.stage));
  return (
    <>
      <div className={`op-debug-verdict is-${verdict.tone}`} role="status">
        <span className="op-debug-verdict__icon" aria-hidden>
          {icons[verdict.tone]}
        </span>
        <div className="op-debug-verdict__body">
          <strong>{verdict.title}</strong>
          {verdict.reason && <p>{verdict.reason}{result.providerMessage?.truncated ? "（已截短）" : ""}</p>}
        </div>
        <div className="op-debug-verdict__meta">
          <span>r{stringifyJson(result.draftRevision)}</span>
          <span>{result.durationMillis} ms</span>
          <span>
            {result.providerDispatch === "NOT_SENT" ? "未发送业务" : result.providerDispatch === "SENT" ? "已发送提供方请求" : "送达情况不确定"}
          </span>
        </div>
      </div>
      {failed.map((check) => (
        <div key={check.stage} className="op-debug-failure">
          <strong>{stages[check.stage] ?? check.stage} · 需处理</strong>
          <p>{check.summary}</p>
          {check.stage === "SCHEMA" && <p>字段路径 $ 从业务数据开始；启用 Response 提取时，公开结构检查的是取出的数据，不包含外层成功码。</p>}
          {check.issues?.map((issue, index) => <p key={index}>{responseIssueText(issue)}</p>)}
          {["REQUEST", "TARGET"].includes(check.stage) && onConfigureTarget && (
            <Button size="small" onClick={onConfigureTarget}>
              检查目标与参数映射
            </Button>
          )}
          {check.stage === "BUSINESS" && (
            <>
              <p>先核对请求参数与调用身份；若提供方实际成功，再检查返回规则。</p>
              <Button size="small" onClick={onCheckRequest}>
                核对请求参数
              </Button>
            </>
          )}
          {check.stage === "AUTHORIZATION" && (
            <Button size="small" onClick={onCheckIdentity}>
              检查调用身份
            </Button>
          )}
        </div>
      ))}
      {repairable && onRepair && (
        <Button size="small" onClick={() => onRepair(failed.some((check) => ["ADAPT", "SCHEMA"].includes(check.stage)))}>
          {failed.some((check) => ["ADAPT", "SCHEMA"].includes(check.stage)) ? "到配置页修复返回规则 / 公开结构" : "检查返回规则"}
        </Button>
      )}
      <Tabs
        className="op-debug-result__tabs"
        size="small"
        activeKey={tab}
        onChange={(value) => onTab(value as ResultTab)}
        items={Object.entries(resultTabs).map(([key, label]) => ({ key, label }))}
      />
      {selected?.available ? (
        <>
          <pre className="op-debug-json">{stringifyJson(selected.value, 2)}</pre>
          {(selected.redacted || selected.truncated) && (
            <small className="op-muted">
              当前展示已{selected.redacted ? "脱敏" : ""}
              {selected.truncated ? "缩略" : ""}，不等于原始业务值。
            </small>
          )}
        </>
      ) : (
        <p className="op-debug-result__unavailable">{selected?.unavailableReason ?? "没有可显示的内容"}</p>
      )}
      <details className="op-debug-checks">
        <summary>
          检查明细 · {result.checks.filter((check) => check.status === "PASSED").length} 项通过{failed.length ? ` · ${failed.length} 项需处理` : ""}
        </summary>
        <ul>
          {result.checks.map((check) => (
            <li key={check.stage}>
              <strong>{stages[check.stage] ?? check.stage}</strong>
              <StatusBadge tone={check.status === "FAILED" ? "error" : check.status === "PASSED" ? "success" : "neutral"}>{statuses[check.status]}</StatusBadge>
              <span>{check.summary}</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="op-debug-trace">
        请求号 <code>{result.requestId}</code> <CopyButton value={result.requestId} label="请求号" />
      </p>
      {kind === "execute" && result.outcome === "SUCCEEDED" && result.publicResponse.available && !result.publicResponse.truncated && businessData != null && onUseExample && (
        <Button type="link" size="small" onClick={() => onUseExample(businessData)}>
          选择公开片段，用作响应示例…
        </Button>
      )}
    </>
  );
}
