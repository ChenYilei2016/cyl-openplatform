import { LoadingOutlined, LoginOutlined, ReloadOutlined, StopOutlined, WarningOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { ReactNode } from "react";
import "./auth.css";

export type AuthStatus = "loading" | "unauthorized" | "forbidden" | "error";

const content: Record<AuthStatus, { icon: ReactNode; title: string; description: string }> = {
  loading: { icon: <LoadingOutlined />, title: "正在验证登录状态…", description: "正在连接本地账号身份服务，请稍候。" },
  unauthorized: { icon: <LoginOutlined />, title: "登录管理后台", description: "使用平台账号登录，平台将核验你的租户身份和后台操作资格。" },
  forbidden: { icon: <StopOutlined />, title: "暂无后台操作资格", description: "当前账号未获得平台管理权限，请联系平台管理员核对租户与人员配置。" },
  error: { icon: <WarningOutlined />, title: "暂时无法连接平台", description: "请检查网络连接后重试；若仍无法连接，请联系平台管理员。" },
};

/** 未进入后台时的独立页面：不显示侧栏与菜单。 */
export default function AuthScreen({ name, status, loginUrl, onRetry }: { name: string; status: AuthStatus; loginUrl: string | null; onRetry: () => void }) {
  const item = content[status];
  return (
    <main id="main" className="op-auth" tabIndex={-1}>
      <section className="op-auth__card" aria-busy={status === "loading"} role={status === "error" || status === "forbidden" ? "alert" : status === "loading" ? "status" : undefined}>
        <div className="op-auth__brand">
          <span className="op-auth__logo" aria-hidden><span /></span>
          <span>{name}<small>管理后台</small></span>
        </div>
        <span className={`op-auth__icon op-auth__icon--${status}`} aria-hidden>{item.icon}</span>
        <h1>{item.title}</h1>
        <p>{item.description}</p>
        {status === "unauthorized" &&
          (loginUrl ? (
            <Button type="primary" size="large" block href={loginUrl}>使用平台账号登录</Button>
          ) : (
            <p className="op-auth__note">尚未配置登录入口，请联系平台管理员。</p>
          ))}
        {(status === "forbidden" || status === "error") && (
          <Button size="large" block icon={<ReloadOutlined aria-hidden />} onClick={onRetry}>
            {status === "forbidden" ? "重新检查资格" : "重新连接"}
          </Button>
        )}
      </section>
      <a className="op-auth__portal" href="/portal/">前往开发者门户 →</a>
    </main>
  );
}
