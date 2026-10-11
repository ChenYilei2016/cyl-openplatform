import { DesktopOutlined, MoonOutlined, SearchOutlined, SunOutlined } from "@ant-design/icons";
import type { DocumentSummary } from "@cyl/open-platform-web-shared/documentation/types";
import { Dropdown, Tooltip } from "antd";
import { useEffect, useRef, type ReactNode } from "react";
import PortalCommandPalette, { type PaletteSection } from "./PortalCommandPalette";
import { usePortalDocumentScope } from "../documentation/PortalDocumentReader";
import type { ColorPreference } from "./useColorMode";
import "./shell.css";

export const portalSections: PaletteSection[] = [
  { section: "home", label: "首页", hint: "平台概览与快速开始" },
  { section: "documents", label: "API 文档", hint: "按分类浏览与在线调试" },
  { section: "guide", label: "接入指南", hint: "凭据、Token、签名与调用" },
  { section: "sdk", label: "SDK", hint: "Java SDK 下载与坐标" },
  { section: "settings", label: "我的接入", hint: "本租户的凭据与授权（需登录）" },
];

const modeOptions: { key: ColorPreference; label: string; icon: ReactNode }[] = [
  { key: "system", label: "跟随系统", icon: <DesktopOutlined /> },
  { key: "light", label: "浅色", icon: <SunOutlined /> },
  { key: "dark", label: "深色", icon: <MoonOutlined /> },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * 门户外壳（115）：深色顶栏（品牌、导航、⌘K 搜索、主题切换）+ 内容区。任何页面按 ⌘K / Ctrl+K 都能搜索 API。
 * 链接用 `?section=`，保留可分享的地址；修饰键点击按浏览器默认在新标签打开。
 */
export default function PortalShell({
  section,
  preference,
  onPreference,
  onNavigate,
  onOpenApi,
  paletteOpen,
  onPaletteOpen,
  children,
}: {
  section: string;
  preference: ColorPreference;
  onPreference: (value: ColorPreference) => void;
  onNavigate: (section: string) => void;
  onOpenApi: (api: DocumentSummary) => void;
  /** 搜索面板的开关由门户持有，首页大搜索框等也能打开它。 */
  paletteOpen: boolean;
  onPaletteOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  const setPaletteOpen = onPaletteOpen;
  const documentScope = usePortalDocumentScope();
  const paletteRef = useRef(paletteOpen);
  paletteRef.current = paletteOpen;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onPaletteOpen(!paletteRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const current = modeOptions.find((item) => item.key === preference) ?? modeOptions[0];
  return (
    <div className="op-portal">
      <a className="op-portal__skip" href="#main">
        跳至主要内容
      </a>
      <header className="op-portal-header">
        <a
          className="op-portal-brand"
          href={location.pathname}
          onClick={(event) => {
            if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate("home");
          }}
        >
          <span className="op-portal-brand__mark" aria-hidden>
            <span />
          </span>
          <span className="op-portal-brand__name">
            CYL Open Platform<small>Developer</small>
          </span>
        </a>
        <nav className="op-portal-nav" aria-label="门户导航">
          {portalSections
            .filter((item) => item.section !== "home" && item.section !== "settings")
            .map((item) => (
              <a
                key={item.section}
                href={`?section=${item.section}`}
                aria-current={section === item.section ? "page" : undefined}
                onClick={(event) => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(item.section);
                }}
              >
                {item.label}
              </a>
            ))}
        </nav>
        <button type="button" className="op-portal-search" onClick={() => setPaletteOpen(true)} aria-label="搜索 API">
          <SearchOutlined aria-hidden />
          <span className="op-portal-search__text">搜索 API…</span>
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <Dropdown
          trigger={["click"]}
          menu={{
            selectable: true,
            selectedKeys: [preference],
            items: modeOptions.map((item) => ({ key: item.key, label: item.label, icon: item.icon })),
            onClick: ({ key }) => onPreference(key as ColorPreference),
          }}
        >
          <Tooltip title={`主题：${current.label}`}>
            <button type="button" className="op-portal-icon-button" aria-label={`切换主题，当前${current.label}`}>
              {current.icon}
            </button>
          </Tooltip>
        </Dropdown>
        <a
          className={`op-portal-access${section === "settings" ? " is-active" : ""}`}
          href="?section=settings"
          aria-current={section === "settings" ? "page" : undefined}
          onClick={(event) => {
            if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate("settings");
          }}
        >
          我的接入
        </a>
      </header>
      <main id="main" className={`op-portal-main op-portal-main--${section}`}>
        {children}
      </main>
      <PortalCommandPalette key={documentScope} open={paletteOpen} onClose={() => setPaletteOpen(false)} sections={portalSections} onOpenSection={onNavigate} onOpenApi={onOpenApi} />
    </div>
  );
}
