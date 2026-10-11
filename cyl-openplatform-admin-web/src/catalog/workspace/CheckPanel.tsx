import { CheckCircleFilled, CloseCircleFilled, InfoCircleFilled, RightOutlined } from "@ant-design/icons";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { CopyButton } from "@cyl/open-platform-web-shared/ui/components";
import { useRead } from "@cyl/open-platform-web-shared/ui/useReadPage";
import { Button } from "antd";
import { HttpRequestPreview } from "../BindingEditor";
import { isOwnerReference } from "../CatalogReferenceFields";
import type { ApiWorkspace } from "../CatalogPanel";
import type { RevisionDetail } from "../versions/types";
import { draftComparable, snapshotComparable } from "./compare";
import { sectionDiffs, sectionOf, sectionTitle, suggestions, type SectionKey } from "./draftModel";
import type { ApiDraft } from "./useApiDraft";

interface CheckItem {
  key: string;
  path: string;
  message: string;
}

/** 右侧检查面板：待修正、建议完善、调用地址、最终请求预览、与生效版差异。 */
export default function CheckPanel({ draft, workspace, onVersions }: { draft: ApiDraft; workspace: ApiWorkspace | null; onVersions: () => void }) {
  const { metadata, lastBinding: binding } = draft;
  const blocking: CheckItem[] = [
    ...draft.issues.map((issue, index) => ({ key: `issue-${index}`, path: issue.path, message: issue.message })),
    ...(draft.manualBindingPending ? [{ key: "signature", path: "/binding", message: "手工签名尚未应用" }] : []),
    ...(draft.bindingCandidate ? [{ key: "binding", path: "/binding", message: "内部绑定替换待确认" }] : []),
    ...draft.unappliedSections.map(section => ({ key: `editing-${section}`, path: section === "request" ? "/requestSchema" : "/responseSchema", message: "字段编辑或 JSON 生成尚未应用" })),
    ...(draft.candidate ? [{ key: "example", path: "/responseSchema", message: "公开示例尚待确认" }] : []),
  ];
  const advice = suggestions(draft.content, isOwnerReference(metadata.owner)).map((item, index) => ({ key: `advice-${index}`, ...item }));
  const address = `POST /api/oauth/${metadata.service}/${metadata.version}/${metadata.method}`;
  const liveRevision = workspace?.liveDraftRevision ?? null;
  const live = useRead<RevisionDetail>(
    draft.api,
    `/apis/${encodeURIComponent(draft.definition.id)}/revisions/${stringifyJson(liveRevision)}`,
    0,
    liveRevision != null,
  );
  const diffs: SectionKey[] = live.data?.snapshot ? sectionDiffs(draftComparable(draft), snapshotComparable(live.data.snapshot)) : [];
  const item = (entry: CheckItem, tone: "error" | "info") => (
    <li key={entry.key}>
      <button type="button" className={`op-check__item op-check__item--${tone}`} onClick={() => draft.locate(entry.path)}>
        <span className="op-check__section">{sectionTitle(sectionOf(entry.path))}</span>
        <span className="op-check__message">{entry.message}</span>
        <RightOutlined aria-hidden className="op-check__go" />
      </button>
    </li>
  );
  return (
    <aside className="op-check" aria-label="检查">
      <section className="op-check__card" aria-label="待修正">
        <h3 className="op-check__title">
          {blocking.length ? <CloseCircleFilled aria-hidden className="op-check__icon--error" /> : <CheckCircleFilled aria-hidden className="op-check__icon--ok" />}
          {blocking.length ? `${blocking.length} 项待修正` : draft.currentValidation?.valid ? "校验通过" : "暂无待修正"}
        </h3>
        {blocking.length > 0 ? (
          <ul className="op-check__list">{blocking.map((entry) => item(entry, "error"))}</ul>
        ) : (
          !draft.currentValidation && <p className="op-check__hint">保存或点击“校验”时检查全部配置。</p>
        )}
        {draft.currentValidation?.truncated && <p className="op-check__hint">问题较多，仅显示前 50 项。</p>}
      </section>
      {advice.length > 0 && (
        <section className="op-check__card" aria-label="建议完善">
          <h3 className="op-check__title">
            <InfoCircleFilled aria-hidden className="op-check__icon--info" />
            {advice.length} 项建议完善
          </h3>
          <ul className="op-check__list">{advice.map((entry) => item(entry, "info"))}</ul>
          <p className="op-check__hint">建议项不影响保存。</p>
        </section>
      )}
      <section className="op-check__card" aria-label="调用地址">
        <h3 className="op-check__title">调用地址</h3>
        <div className="op-check__address">
          <code>{address}</code>
          <CopyButton value={address} label="调用地址" />
        </div>
      </section>
      <details className="op-check__card op-check__details">
        <summary className="op-check__title">最终请求预览</summary>
        {binding.protocol === "HTTP" ? (
          <div className="op-legacy-editor op-check__preview">
            <HttpRequestPreview binding={binding} mappings={draft.lastMappings} requestSchema={draft.lastRequest} />
          </div>
        ) : (
          <div className="op-check__preview">
            <code className="op-check__code">
              {binding.dubbo?.interfaceName || "接口未填写"}#{binding.dubbo?.method || "方法"}({(binding.dubbo?.parameterTypes ?? []).map((type) => type.split(".").pop()).join(", ")})
            </code>
            <ul className="op-check__mappings">
              {draft.lastMappings.map((mapping, index) => (
                <li key={index}>
                  <code>{mapping.target || "（未填）"}</code> ← {mapping.source === "REQUEST" ? `请求 ${mapping.path ?? ""}` : mapping.source === "CONTEXT" ? `平台身份 ${mapping.path ?? ""}` : `固定值 ${stringifyJson(mapping.value)}`}
                </li>
              ))}
              {!draft.lastMappings.length && <li className="op-muted">尚未配置参数映射</li>}
            </ul>
          </div>
        )}
      </details>
      {!draft.creation && <section className="op-check__card" aria-label="与生效版差异">
        <h3 className="op-check__title">与生效版本</h3>
        {liveRevision == null ? (
          <p className="op-check__hint">尚未发布，没有可比较的生效版本。</p>
        ) : live.loading && !live.data ? (
          <p className="op-check__hint">正在读取生效 r{stringifyJson(liveRevision)}…</p>
        ) : live.error ? (
          <p className="op-check__hint">{live.error}</p>
        ) : diffs.length ? (
          <>
            <p className="op-check__diff">
              与生效 r{stringifyJson(liveRevision)} 相比，<strong>{diffs.length}</strong> 个分区有变化：{diffs.map(sectionTitle).join("、")}
            </p>
            <Button type="link" size="small" className="op-check__link" onClick={onVersions}>
              查看版本记录
            </Button>
          </>
        ) : (
          <p className="op-check__hint">与生效 r{stringifyJson(liveRevision)} 一致。</p>
        )}
      </section>}
    </aside>
  );
}
