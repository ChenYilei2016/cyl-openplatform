import { compatibilityNames, lifecycleStatusNames, type ApiLifecycle } from "@cyl/open-platform-web-shared/lifecycle";
import { FieldLabel } from "@cyl/open-platform-web-shared/ui/components";
import { Input, Radio, Select } from "antd";
import { useState } from "react";
import "./lifecycle.css";

export function lifecycleIssues(value: ApiLifecycle, version: string) {
  return {
    notice: value.status !== "ACTIVE" && !value.deprecationNotice.trim() ? "请填写迁移或停止服务公告。" : "",
    compatibility: value.compatibility !== "UNSPECIFIED" && !value.compatibilityNotes.trim() ? "请说明本次变更的兼容性。" : "",
    replacement:
      value.replacementVersion && (value.replacementVersion === version || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/.test(value.replacementVersion))
        ? "请填写不同于当前版本的合法外部版本。"
        : "",
  };
}

const statusHints: Record<ApiLifecycle["status"], string> = {
  ACTIVE: "按当前授权正常服务。切回正常会清除迁移公告、替代版本与计划日期。",
  DEPRECATED: "发布后在文档中提醒迁移，仍允许调用。",
  RETIRED: "发布后调用返回 410；启用中的公开文档仍可阅读。",
};

/** 维护声明表单：状态 → （非正常时）迁移公告、替代版本、计划日期 → 可选兼容性声明。 */
export default function LifecycleFields({
  value,
  version,
  onChange,
  disabled = false,
}: {
  value: ApiLifecycle;
  version: string;
  onChange: (patch: Partial<ApiLifecycle>) => void;
  disabled?: boolean;
}) {
  const issues = lifecycleIssues(value, version);
  // 刚切换状态时公告还未填写，离开该输入框后才提示，避免过早报错。
  const [noticeTouched, setNoticeTouched] = useState(false);
  const noticeIssue = noticeTouched ? issues.notice : "";
  return (
    <fieldset className="op-lifecycle-fields" disabled={disabled}>
      <div className="op-lifecycle-fields__item">
        <FieldLabel label="维护状态" />
        <Radio.Group
          aria-label="生命周期状态"
          optionType="button"
          value={value.status}
          disabled={disabled}
          options={Object.entries(lifecycleStatusNames).map(([key, name]) => ({ value: key, label: name }))}
          onChange={(event) => {
            const status = event.target.value as ApiLifecycle["status"];
            onChange({ status, ...(status === "ACTIVE" ? { deprecationNotice: "", replacementVersion: null, sunsetDate: null } : {}) });
          }}
        />
        <span className="op-lifecycle-fields__hint">{statusHints[value.status]}</span>
      </div>
      {value.status !== "ACTIVE" && (
        <>
          <label className="op-lifecycle-fields__item">
            <FieldLabel label="迁移 / 停止服务公告" required />
            <Input.TextArea
              aria-label="废弃说明"
              value={value.deprecationNotice}
              required
              status={noticeIssue ? "error" : undefined}
              onBlur={() => setNoticeTouched(true)}
              maxLength={2000}
              autoSize={{ minRows: 3, maxRows: 7 }}
              onChange={(event) => onChange({ deprecationNotice: event.target.value })}
              placeholder="说明迁移原因、替代方案和接入方需要完成的动作"
            />
            {noticeIssue && <span className="op-lifecycle-fields__error">{noticeIssue}</span>}
          </label>
          <div className="op-lifecycle-fields__grid">
            <label className="op-lifecycle-fields__item">
              <FieldLabel label="替代外部版本（可选）" />
              <Input
                aria-label="替代外部版本"
                maxLength={32}
                status={issues.replacement ? "error" : undefined}
                value={value.replacementVersion ?? ""}
                onChange={(event) => onChange({ replacementVersion: event.target.value || null })}
                placeholder="例如 v2"
              />
              {issues.replacement && <span className="op-lifecycle-fields__error">{issues.replacement}</span>}
            </label>
            <label className="op-lifecycle-fields__item">
              <FieldLabel label="计划退出日期（可选）" help="仅作公告，到期不会自动停用。" />
              <Input aria-label="计划退出日期" type="date" value={value.sunsetDate ?? ""} onChange={(event) => onChange({ sunsetDate: event.target.value || null })} />
            </label>
          </div>
        </>
      )}
      <details className="op-lifecycle-fields__compat" open={value.compatibility !== "UNSPECIFIED" || !!value.compatibilityNotes}>
        <summary>兼容性声明（可选）· {compatibilityNames[value.compatibility]}</summary>
        <div className="op-lifecycle-fields__grid">
          <label className="op-lifecycle-fields__item">
            <FieldLabel label="兼容性声明" help="由维护者声明，不是自动兼容性证明。外部版本与 Dubbo 内部版本相互独立，替代版本不会自动跳转或授予访问。" />
            <Select
              aria-label="兼容性声明"
              value={value.compatibility}
              disabled={disabled || undefined}
              options={Object.entries(compatibilityNames).map(([key, name]) => ({ value: key, label: name }))}
              onChange={(compatibility: ApiLifecycle["compatibility"]) => onChange({ compatibility })}
            />
          </label>
          <label className="op-lifecycle-fields__item op-lifecycle-fields__item--wide">
            <FieldLabel label="兼容性说明" required={value.compatibility !== "UNSPECIFIED"} />
            <Input.TextArea
              aria-label="兼容性说明"
              required={value.compatibility !== "UNSPECIFIED"}
              status={issues.compatibility ? "error" : undefined}
              value={value.compatibilityNotes}
              maxLength={2000}
              autoSize={{ minRows: 2, maxRows: 5 }}
              onChange={(event) => onChange({ compatibilityNotes: event.target.value })}
            />
            {issues.compatibility && <span className="op-lifecycle-fields__error">{issues.compatibility}</span>}
          </label>
        </div>
      </details>
    </fieldset>
  );
}
