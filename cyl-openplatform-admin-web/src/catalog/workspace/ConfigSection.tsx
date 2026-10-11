import type { ReactNode } from "react";
import type { CandidateValidation } from "../WorkspaceValidation";
import type { SectionKey } from "./draftModel";

/** 配置页中的一个分区：锚点 id 固定为 config-<key>，供目录跳转与滚动高亮。 */
/** scope：对外（客户可见的契约）/ 对内（平台到内部服务的实现），帮助区分两类配置。 */
export function ConfigSection({ id, title, scope, description, actions, children }: { id: SectionKey; title: string; scope?: "对外" | "对内" | "对内 → 对外"; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={`config-${id}`} data-section={id} className="op-config-section" aria-labelledby={`config-${id}-title`}>
      <header className="op-config-section__head">
        <div>
          <h2 id={`config-${id}-title`}>
            {title}
            {scope && <span className={`op-config-scope ${scope === "对内" ? "is-inner" : scope === "对外" ? "is-outer" : "is-both"}`}>{scope}</span>}
          </h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="op-config-section__actions">{actions}</div>}
      </header>
      <div className="op-config-section__body">{children}</div>
    </section>
  );
}

/** 分区内的小标题块（如“参数放在哪里”），不再嵌套折叠。 */
export function ConfigBlock({ title, help, actions, children, path }: { title: ReactNode; help?: ReactNode; actions?: ReactNode; children: ReactNode; path?: string }) {
  return (
    <div className="op-config-block" data-field-path={path} tabIndex={path ? -1 : undefined}>
      <div className="op-config-block__head">
        <h3>
          {title}
          {help}
        </h3>
        {actions && <div className="op-config-block__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** 服务端字段问题：只显示路径在此处（或其子路径）的前 3 条。 */
export function issuesAt(result: CandidateValidation | null, path: string) {
  return result?.valid === false ? result.fieldIssues.filter((issue) => issue.path === path || issue.path.startsWith(path + "/")) : [];
}
export function IssueText({ result, path }: { result: CandidateValidation | null; path: string }) {
  const issues = issuesAt(result, path);
  if (!issues.length) return null;
  return (
    <div className="op-config-issue" role="alert">
      {issues.slice(0, 3).map((issue, index) => (
        <div key={index}>{issue.message}</div>
      ))}
    </div>
  );
}
