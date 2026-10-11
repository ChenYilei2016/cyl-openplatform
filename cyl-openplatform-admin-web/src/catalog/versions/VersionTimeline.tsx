import { CloudUploadOutlined, EditOutlined, RollbackOutlined } from "@ant-design/icons";
import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { PersonTag, StatusBadge, type StatusTone } from "@cyl/open-platform-web-shared/ui/components";
import { Button, Checkbox, Tooltip } from "antd";
import { releaseOutcome, type ReleaseSummary } from "../../publication/types";
import type { RevisionSummary } from "./types";
import type { TimelineEntry } from "./useTimeline";

const releaseTone = (release: ReleaseSummary): StatusTone =>
  release.status === "APPLIED" ? "success" : release.status === "PENDING" ? "processing" : "error";
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export interface TimelineActions {
  currentDraft: string;
  liveReleaseId: string | null;
  canRestore: boolean;
  canRollback: boolean;
  /** 不能回滚的原因（待审核、结果未知等）；为空表示可以。 */
  rollbackBlocked: string;
  onCompareCurrent: (revision: string) => void;
  onRestore: (revision: string) => void;
  onProvenance: (revision: string) => void;
  onReview: (releaseId: string) => void;
  onRollback: (releaseId: string) => void;
}

/** 草稿修订与发布记录的统一时间线；勾选任意两项后由页面工具栏发起比较。 */
export default function VersionTimeline({
  entries,
  selected,
  onToggle,
  actions,
}: {
  entries: TimelineEntry[];
  selected: string[];
  onToggle: (entry: TimelineEntry) => void;
  actions: TimelineActions;
}) {
  return (
    <ol className="op-timeline" aria-label="版本时间线">
      {entries.map((entry) => {
        const checked = selected.includes(entry.key);
        const full = !checked && selected.length >= 2;
        return (
          <li key={entry.key} className={`op-timeline__item op-timeline__item--${entry.kind}${checked ? " is-selected" : ""}`}>
            <Tooltip title={full ? "最多选择两项进行比较" : undefined}>
              <Checkbox
                className="op-timeline__check"
                aria-label={`选择${entry.kind === "revision" ? `草稿 r${stringifyJson(entry.revision.revision)}` : `发布 r${stringifyJson(entry.release.draftRevision)}`}`}
                checked={checked}
                disabled={full}
                onChange={() => onToggle(entry)}
              />
            </Tooltip>
            <span className="op-timeline__dot" aria-hidden>
              {entry.kind === "revision" ? <EditOutlined /> : entry.release.kind === "ROLLBACK" ? <RollbackOutlined /> : <CloudUploadOutlined />}
            </span>
            {entry.kind === "revision" ? <RevisionRow revision={entry.revision} actions={actions} /> : <ReleaseRow release={entry.release} actions={actions} />}
          </li>
        );
      })}
    </ol>
  );
}

function RevisionRow({ revision, actions }: { revision: RevisionSummary; actions: TimelineActions }) {
  const number = stringifyJson(revision.revision);
  const current = number === actions.currentDraft;
  return (
    <>
      <div className="op-timeline__main">
        <div className="op-timeline__title">
          <span className="op-timeline__kind">草稿</span>
          <strong className="op-timeline__rev">r{number}</strong>
          {current && <StatusBadge tone="info">当前草稿</StatusBadge>}
          {revision.historyStart && <StatusBadge tone="neutral">历史起点</StatusBadge>}
        </div>
        <p className="op-timeline__desc">
          {revision.summary || revision.source}
          {revision.restoredFromRevision != null && ` · 来自 r${stringifyJson(revision.restoredFromRevision)}`}
        </p>
      </div>
      <div className="op-timeline__meta">
        {revision.operatorEmployeeNo ? <PersonTag name={revision.operatorName} employeeNo={revision.operatorEmployeeNo} /> : <span className="op-muted">操作人未记录</span>}
        <time dateTime={revision.recordedAt} title={revision.historyStart ? "归档时间，原保存时间未记录" : undefined}>
          {time(revision.recordedAt)}
        </time>
      </div>
      <div className="op-timeline__actions">
        {!current && (
          <Button type="link" size="small" onClick={() => actions.onCompareCurrent(number)}>
            与当前草稿比较
          </Button>
        )}
        {actions.canRestore && !current && (
          <Button type="link" size="small" aria-label={`恢复 r${number} 为草稿`} onClick={() => actions.onRestore(number)}>
            恢复为草稿
          </Button>
        )}
        {actions.canRestore && revision.source.startsWith("IMPORT_") && (
          <Button type="link" size="small" onClick={() => actions.onProvenance(number)}>
            导入资料
          </Button>
        )}
      </div>
    </>
  );
}

function ReleaseRow({ release, actions }: { release: ReleaseSummary; actions: TimelineActions }) {
  const number = stringifyJson(release.draftRevision);
  const live = actions.liveReleaseId === release.id;
  const canRollback = actions.canRollback && release.status === "APPLIED" && !live;
  return (
    <>
      <div className="op-timeline__main">
        <div className="op-timeline__title">
          <span className="op-timeline__kind">{release.kind === "ROLLBACK" ? "回滚发布" : "发布"}</span>
          <strong className="op-timeline__rev">r{number}</strong>
          <StatusBadge tone={releaseTone(release)}>{releaseOutcome(release)}</StatusBadge>
          {live && <StatusBadge tone="success">当前生效</StatusBadge>}
        </div>
        <p className="op-timeline__desc">
          {release.comment || <span className="op-muted">未填写发布备注</span>}
          {release.failureReason && <span className="op-timeline__failure"> · {release.failureReason}</span>}
        </p>
      </div>
      <div className="op-timeline__meta">
        <span className="op-timeline__people">
          <PersonTag name={release.submittedByName} employeeNo={release.submittedByEmployeeNo} />
          {release.reviewedByEmployeeNo && (
            <>
              <span className="op-muted">审核</span>
              <PersonTag name={release.reviewedByName} employeeNo={release.reviewedByEmployeeNo} />
            </>
          )}
        </span>
        <time dateTime={release.submittedAt}>{time(release.submittedAt)}</time>
      </div>
      <div className="op-timeline__actions">
        <Button type="link" size="small" onClick={() => actions.onReview(release.id)}>
          查看快照
        </Button>
        {canRollback && (
          <Tooltip title={actions.rollbackBlocked || undefined}>
            <Button type="link" size="small" disabled={!!actions.rollbackBlocked} aria-label={`回滚到 r${number}`} onClick={() => actions.onRollback(release.id)}>
              回滚到此版本
            </Button>
          </Tooltip>
        )}
      </div>
    </>
  );
}
