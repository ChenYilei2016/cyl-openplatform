import { ExclamationCircleOutlined, FileSearchOutlined, LockOutlined, InboxOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

const presets = {
  empty: { icon: <InboxOutlined />, title: "这里还没有内容" },
  notFound: { icon: <FileSearchOutlined />, title: "没有找到这个页面" },
  signedOut: { icon: <LockOutlined />, title: "登录已失效" },
  error: { icon: <ExclamationCircleOutlined />, title: "暂时无法读取" },
} as const;

/** 门户统一的空态 / 404 / 登录失效 / 读取失败：说明发生了什么，并给出下一步。 */
export default function StatusPage({ kind, title, description, actions, compact = false }: { kind: keyof typeof presets; title?: ReactNode; description?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  const preset = presets[kind];
  return (
    <section className={`op-status-page op-status-page--${kind}${compact ? " op-status-page--compact" : ""}`} role={kind === "error" ? "alert" : "status"}>
      <span className="op-status-page__icon" aria-hidden>
        {preset.icon}
      </span>
      <h2 className="op-status-page__title">{title ?? preset.title}</h2>
      {description && <p className="op-status-page__description">{description}</p>}
      {actions && <div className="op-status-page__actions">{actions}</div>}
    </section>
  );
}
