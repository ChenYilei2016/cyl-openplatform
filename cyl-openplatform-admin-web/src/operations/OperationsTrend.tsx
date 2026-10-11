import { useState, type MouseEvent } from "react";
import { chartGroups, displayTime } from "./model";
import type { OperationsStatistics } from "./types";

/** 纵轴取整到 1/2/5×10ⁿ，刻度为干净的整数。 */
function niceMaximum(value: number) {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * power >= value) ?? 10) * power;
}

/**
 * 请求量趋势（dataviz：单一主色 + 失败状态色，柱宽不超过 24px，悬停提示，无阴影/3D）。
 * 最多 60 段、覆盖完整查询区间；点击柱查看该时段调用，点击失败部分只看失败调用。精确值见分桶明细。
 */
export default function OperationsTrend({
  data,
  onDrill,
}: {
  data: OperationsStatistics;
  onDrill: (from: string, to: string, onlyFailures?: boolean) => void;
}) {
  const groups = chartGroups(data);
  const maximum = niceMaximum(Math.max(...groups.map((group) => Number(group.requests))));
  const [active, setActive] = useState<number | null>(null);
  const current = active === null ? null : groups[active];
  const percent = (value: string) => `${(Number(value) / maximum) * 100}%`;
  const drill = (index: number, event?: MouseEvent) => {
    const group = groups[index];
    const failurePart = (event?.target as HTMLElement | undefined)?.dataset.part === "failure";
    onDrill(group.from, group.to, failurePart);
  };
  return (
    <figure className="op-trend">
      <div className="op-trend__plot" onMouseLeave={() => setActive(null)}>
        <div className="op-trend__grid" aria-hidden>
          {[1, 0.5, 0].map((fraction) => (
            <span key={fraction} style={{ bottom: `${fraction * 100}%` }}>
              <em>{Math.round(maximum * fraction).toLocaleString()}</em>
            </span>
          ))}
        </div>
        <div className="op-trend__bars" role="group" aria-label="请求量趋势，点击分段查看调用日志">
          {groups.map((group, index) => (
            <button
              key={group.from}
              type="button"
              className={`op-trend__slot${active === index ? " is-active" : ""}`}
              aria-label={`${displayTime(group.from)} 至 ${displayTime(group.to)}，请求 ${group.requests}，失败 ${group.failures}，查看调用日志`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              onClick={(event) => drill(index, event)}
            >
              <span className="op-trend__column" style={{ height: percent(group.requests) }}>
                {group.failures !== "0" && (
                  <span className="op-trend__failure" data-part="failure" style={{ flexGrow: Number(group.failures) }} />
                )}
                {group.requests !== group.failures && (
                  <span className="op-trend__success" style={{ flexGrow: Number(group.requests) - Number(group.failures) }} />
                )}
              </span>
            </button>
          ))}
        </div>
        {current && (
          <div
            className={`op-trend__tooltip${active! > groups.length / 2 ? " is-left" : ""}`}
            style={{ left: `${((active! + 0.5) / groups.length) * 100}%` }}
            role="status"
          >
            <strong>
              {displayTime(current.from)} – {displayTime(current.to)}
            </strong>
            <span>
              <i className="op-trend__key op-trend__key--success" aria-hidden />
              请求 {current.requests}
            </span>
            <span>
              <i className="op-trend__key op-trend__key--failure" aria-hidden />
              失败 {current.failures}
            </span>
            <span>实际拒绝 {current.rejected} · 观察命中 {current.observed}</span>
            <small>点击查看该时段调用{current.failures !== "0" ? "，点击红色部分只看失败" : ""}</small>
          </div>
        )}
      </div>
      <figcaption className="op-trend__footer">
        <span>{displayTime(data.from)}</span>
        <span className="op-trend__legend">
          <span>
            <i className="op-trend__key op-trend__key--success" aria-hidden />
            成功
          </span>
          <span>
            <i className="op-trend__key op-trend__key--failure" aria-hidden />
            失败
          </span>
        </span>
        <span>{displayTime(data.to)}</span>
      </figcaption>
    </figure>
  );
}
