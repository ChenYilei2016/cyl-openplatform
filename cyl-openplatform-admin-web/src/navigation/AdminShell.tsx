import { signOut } from '@cyl/open-platform-web-shared/session/signOut';
import {
  ApiOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BellOutlined,
  BookOutlined,
  CodeOutlined,
  DashboardOutlined,
  ExportOutlined,
  FileSearchOutlined,
  LineChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  NodeIndexOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SolutionOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { EntityDrawer, StatusBadge } from "@cyl/open-platform-web-shared/ui/components";
import { Button, Dropdown, Tag, Tooltip, message } from "antd";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import type { AdminApi } from "../access/api";
import { permissionNames } from "../administration/types";
import { useAdminNavigation } from "./AdminNavigation";
import CommandPalette, { useRecentPages } from "./CommandPalette";
import { activeEntryPath, canSee, navigationGroups, pageEntries, titleFor } from "./routes";
import "./shell.css";

const icons: Record<string, ReactNode> = {
  "/workbench": <DashboardOutlined />,
  "/apis": <ApiOutlined />,
  "/reviews": <SolutionOutlined />,
  "/docs": <BookOutlined />,
  "/credentials": <AppstoreOutlined />,
  "/scopes": <SafetyCertificateOutlined />,
  "/tenant-permissions": <ApartmentOutlined />,
  "/mcp": <RobotOutlined />,
  "/connections": <NodeIndexOutlined />,
  "/analytics": <LineChartOutlined />,
  "/logs": <FileSearchOutlined />,
  "/alerts": <BellOutlined />,
  "/traffic-rules": <ThunderboltOutlined />,
  "/admins": <TeamOutlined />,
  "/audits": <AuditOutlined />,
  "/sdk": <CodeOutlined />,
};

export interface ShellSession {
  permissions: string[];
  superAdministrator: boolean;
  displayName: string;
  employeeNo: string;
  tenantId: string;
}

const COLLAPSE_KEY = "op-admin-sidebar-collapsed";
const readCollapsed = () => {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
};

/** 环境标记：生产/预发醒目，其余中性。 */
function EnvironmentBadge({ environmentId }: { environmentId?: string }) {
  const id = environmentId?.trim() || "未标注环境";
  const tone = /^prod/i.test(id) ? "error" : /^pre/i.test(id) ? "warning" : "neutral";
  return (
    <Tooltip title={`当前站点：${window.location.host}`}>
      <span className="op-shell__env" aria-label={`当前环境 ${id}`}>
        <StatusBadge tone={tone}>{id}</StatusBadge>
      </span>
    </Tooltip>
  );
}

export default function AdminShell({
  name,
  environmentId,
  session,
  api,
  children,
}: {
  name: string;
  environmentId?: string;
  session: ShellSession;
  /** 命令面板实体搜索（114 B4）使用；未提供时只搜索页面与最近访问。 */
  api?: AdminApi;
  children: ReactNode;
}) {
  const { route } = useAdminNavigation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const recent = useRecentPages(route);
  const visible = pageEntries.filter((entry) => canSee(entry, session));
  const active = activeEntryPath(route);
  const current = visible.find((entry) => entry.path === active);
  const toggle = useCallback(() => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {
        /* 本地存储不可用时只在本页生效。 */
      }
      return !value;
    });
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
  return (
    <div className={`op-shell platform-admin${collapsed ? " op-shell--collapsed" : ""}`}>
      <a
        className="op-shell__skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳至主要内容
      </a>
      <aside className="op-shell__sidebar">
        <div className="op-shell__brand">
          <NavLink to="/workbench" className="op-shell__brand-link" aria-label={`${name} 工作台`}>
            <span className="op-shell__logo" aria-hidden>
              <span />
            </span>
            {!collapsed && (
              <span className="op-shell__brand-text">
                {name}
                <small>管理后台</small>
              </span>
            )}
          </NavLink>
        </div>
        <nav className="op-shell__nav" aria-label="后台主导航">
          {navigationGroups.map((group) => {
            const items = visible.filter((entry) => entry.group === group);
            if (!items.length) return null;
            return (
              <section key={group} className="op-shell__group" aria-label={group === "工作台" ? undefined : group}>
                {group !== "工作台" && !collapsed && <h2>{group}</h2>}
                {items.map((entry) => {
                  const link = (
                    <NavLink
                      key={entry.path}
                      to={entry.path}
                      aria-label={collapsed ? entry.title : undefined}
                      aria-current={entry.path === active ? "page" : undefined}
                      className={() => `op-shell__item${entry.path === active ? " is-active" : ""}`}
                    >
                      <span className="op-shell__icon" aria-hidden>{icons[entry.path]}</span>
                      {!collapsed && <span className="op-shell__label">{entry.title}</span>}
                    </NavLink>
                  );
                  return collapsed ? (
                    <Tooltip key={entry.path} title={entry.title} placement="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  );
                })}
              </section>
            );
          })}
        </nav>
        <div className="op-shell__sidebar-foot">
          <a className="op-shell__item" href="/portal/" target="_blank" rel="noreferrer" aria-label="开发者门户（新窗口）">
            <span className="op-shell__icon" aria-hidden><ExportOutlined /></span>
            {!collapsed && <span className="op-shell__label">开发者门户</span>}
          </a>
          <button type="button" className="op-shell__item op-shell__collapse" onClick={toggle} aria-label={collapsed ? "展开侧栏" : "收起侧栏"}>
            <span className="op-shell__icon" aria-hidden>{collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}</span>
            {!collapsed && <span className="op-shell__label">收起侧栏</span>}
          </button>
        </div>
      </aside>
      <div className="op-shell__workspace">
        <header className="op-shell__header">
          <div className="op-shell__crumbs" aria-label="当前位置">
            {current && current.group !== "工作台" && <span className="op-shell__crumb-group">{current.group}</span>}
            <span className="op-shell__crumb-title">{titleFor(route)}</span>
          </div>
          <button type="button" className="op-shell__search" onClick={() => setPaletteOpen(true)} aria-label="搜索页面（快捷键 Ctrl+K 或 ⌘K）">
            <SearchOutlined aria-hidden />
            <span className="op-shell__search-text">搜索页面或最近访问</span>
            <kbd>{shortcut}</kbd>
          </button>
          <div className="op-shell__header-end">
            <EnvironmentBadge environmentId={environmentId} />
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "account", label: "账号与权限" },
                  { key: "logout", label: "退出登录" },
                  { key: "portal", label: <a href="/portal/" target="_blank" rel="noreferrer">打开开发者门户</a> },
                ],
                onClick: ({ key }) => { if (key === "account") setAccountOpen(true); if (key === "logout") void signOut().catch(error => message.error(error.message)); },
              }}
            >
              <Button type="text" className="op-shell__user" icon={<UserOutlined />} aria-label="查看账号与权限">
                {session.displayName || session.employeeNo}
              </Button>
            </Dropdown>
          </div>
        </header>
        {children}
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} entries={visible} recent={recent} api={api} />
      <EntityDrawer
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        title={session.displayName || session.employeeNo}
        status={session.superAdministrator ? <StatusBadge tone="info">总管理员</StatusBadge> : undefined}
      >
        <dl className="op-shell__account">
          <dt>工号</dt>
          <dd>{session.employeeNo}</dd>
          <dt>租户 ID</dt>
          <dd className="op-code">{session.tenantId}</dd>
          <dt>操作权限</dt>
          <dd>
            {session.permissions.length ? (
              <span className="op-shell__permissions">
                {session.permissions.map((permission) => (
                  <Tag key={permission} bordered={false}>{permissionNames[permission] ?? permission}</Tag>
                ))}
              </span>
            ) : (
              <span className="op-muted">当前未分配操作权限，请联系平台管理员。</span>
            )}
          </dd>
        </dl>
        <p className="op-muted">权限由平台核验；需要调整时，请联系总管理员。</p>
      </EntityDrawer>
    </div>
  );
}
