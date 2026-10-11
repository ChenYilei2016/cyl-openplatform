import { theme as antdTheme, type ThemeConfig } from "antd";

/**
 * 全站唯一设计令牌来源（106 第 3.1 节）。
 * 页面样式只引用这里生成的 CSS 变量；antd 主题也由同一组值生成。
 */
export type ThemeVariant = "admin" | "portal";
export type ColorMode = "light" | "dark";

const status = {
  success: "#168468",
  warning: "#b77712",
  error: "#cc4141",
  info: "#335cff",
  neutral: "#8a94a6",
} as const;

interface Palette {
  primary: string;
  primaryHover: string;
  primarySoft: string;
  accent: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  divider: string;
  bgLayout: string;
  bgSurface: string;
  bgSubtle: string;
  bgHover: string;
  bgSelected: string;
  successSoft: string;
  warningSoft: string;
  errorSoft: string;
  codeBg: string;
  codeText: string;
}

const light: Palette = {
  primary: "#335cff",
  primaryHover: "#2a4fe6",
  primarySoft: "#eef2ff",
  accent: "#22d3ee",
  text: "#1f2633",
  textSecondary: "#5f6b7c",
  textTertiary: "#8a94a6",
  border: "#e3e8ef",
  divider: "#eef1f5",
  bgLayout: "#f6f7f9",
  bgSurface: "#ffffff",
  bgSubtle: "#f9fafb",
  bgHover: "#f7f9fc",
  bgSelected: "#eef2ff",
  successSoft: "#e8f5f0",
  warningSoft: "#fdf5e6",
  errorSoft: "#fcecec",
  codeBg: "#0f172a",
  codeText: "#e2e8f0",
};

const dark: Palette = {
  primary: "#5b7cff",
  primaryHover: "#7390ff",
  primarySoft: "#1b2550",
  accent: "#22d3ee",
  text: "#e6eaf2",
  textSecondary: "#a3adbf",
  textTertiary: "#77829a",
  border: "#253049",
  divider: "#1c2539",
  bgLayout: "#0a0f1f",
  bgSurface: "#111a33",
  bgSubtle: "#0e1630",
  bgHover: "#16213f",
  bgSelected: "#1b2550",
  successSoft: "#0f2e27",
  warningSoft: "#33270f",
  errorSoft: "#3a1717",
  codeBg: "#070b17",
  codeText: "#e2e8f0",
};

export const typography = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontFamilyCode: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  /** 只此六档：辅助、表格/标签、正文、区块标题、页面标题、门户大标题。 */
  size: { xs: 12, sm: 13, md: 14, lg: 16, xl: 20, xxl: 24 },
  lineHeight: { xs: 18, sm: 20, md: 22, lg: 24, xl: 28, xxl: 32 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 4, md: 6, lg: 8, xl: 12 } as const;
export const control = { sm: 24, md: 32, lg: 40 } as const;
/** 表格行：单行约 36px，两行主列（名称 + 等宽标识）约 52px，1440×900 首屏 ≥ 12 行。 */
export const layout = { sidebar: 220, sidebarCollapsed: 64, header: 48, tableRowTwoLine: 52 } as const;

export function palette(mode: ColorMode = "light"): Palette {
  return mode === "dark" ? dark : light;
}

/** CSS 自定义属性，页面 CSS 只能通过 var(--op-*) 使用。 */
export function cssVariables(mode: ColorMode = "light"): Record<string, string> {
  const p = palette(mode);
  const shadowColor = mode === "dark" ? "0, 0, 0" : "15, 23, 42";
  return {
    "--op-color-primary": p.primary,
    "--op-color-primary-hover": p.primaryHover,
    "--op-color-primary-soft": p.primarySoft,
    "--op-color-accent": p.accent,
    "--op-color-on-primary": "#ffffff",
    "--op-gradient-accent": `linear-gradient(90deg, ${p.primary} 0%, ${p.accent} 100%)`,
    "--op-color-text": p.text,
    "--op-color-text-secondary": p.textSecondary,
    "--op-color-text-tertiary": p.textTertiary,
    "--op-color-border": p.border,
    "--op-color-divider": p.divider,
    "--op-color-bg-layout": p.bgLayout,
    "--op-color-bg-surface": p.bgSurface,
    "--op-color-bg-subtle": p.bgSubtle,
    "--op-color-bg-hover": p.bgHover,
    "--op-color-bg-selected": p.bgSelected,
    "--op-color-success": status.success,
    "--op-color-warning": status.warning,
    "--op-color-error": status.error,
    "--op-color-info": p.primary,
    "--op-color-neutral": status.neutral,
    "--op-color-success-soft": p.successSoft,
    "--op-color-warning-soft": p.warningSoft,
    "--op-color-error-soft": p.errorSoft,
    "--op-color-code-bg": p.codeBg,
    "--op-color-code-text": p.codeText,
    // 门户“深色门面”（115）：顶栏与首页在浅色模式下也保持深色，与模式无关。
    "--op-portal-chrome-bg": "#0a0f1f",
    "--op-portal-chrome-bg-2": "#111a33",
    "--op-portal-chrome-surface": "rgba(255, 255, 255, 0.04)",
    "--op-portal-chrome-surface-hover": "rgba(255, 255, 255, 0.08)",
    "--op-portal-chrome-border": "rgba(255, 255, 255, 0.10)",
    "--op-portal-chrome-text": "#e6eaf2",
    "--op-portal-chrome-text-secondary": "#a3adbf",
    "--op-portal-chrome-text-tertiary": "#77829a",
    "--op-portal-grid-line": "rgba(255, 255, 255, 0.05)",
    "--op-portal-glow": "rgba(51, 92, 255, 0.35)",
    "--op-portal-glow-accent": "rgba(34, 211, 238, 0.18)",
    // HTTP 方法徽标与代码高亮（深色代码块，两种模式相同）。
    "--op-method-get": "#16a34a",
    "--op-method-post": "#335cff",
    "--op-method-put": "#d97706",
    "--op-method-delete": "#dc2626",
    "--op-method-patch": "#7c3aed",
    "--op-code-comment": "#64748b",
    "--op-code-keyword": "#c084fc",
    "--op-code-string": "#86efac",
    "--op-code-number": "#fbbf24",
    "--op-code-property": "#7dd3fc",
    "--op-code-function": "#93c5fd",
    "--op-code-punctuation": "#94a3b8",
    "--op-code-line-number": "#475569",
    "--op-shadow-popover": `0 6px 24px rgba(${shadowColor}, 0.12), 0 1px 3px rgba(${shadowColor}, 0.08)`,
    "--op-shadow-drawer": `-8px 0 32px rgba(${shadowColor}, 0.14)`,
    "--op-font-family": typography.fontFamily,
    "--op-font-code": typography.fontFamilyCode,
    ...Object.fromEntries(
      Object.entries(typography.size).flatMap(([key, value]) => [
        [`--op-font-size-${key}`, `${value}px`],
        [`--op-line-height-${key}`, `${typography.lineHeight[key as keyof typeof typography.lineHeight]}px`],
      ]),
    ),
    ...Object.fromEntries(Object.entries(space).map(([key, value]) => [`--op-space-${key}`, `${value}px`])),
    ...Object.fromEntries(Object.entries(radius).map(([key, value]) => [`--op-radius-${key}`, `${value}px`])),
    ...Object.fromEntries(Object.entries(control).map(([key, value]) => [`--op-control-${key}`, `${value}px`])),
    "--op-layout-sidebar": `${layout.sidebar}px`,
    "--op-layout-sidebar-collapsed": `${layout.sidebarCollapsed}px`,
    "--op-layout-header": `${layout.header}px`,
    "--op-layout-table-row-two-line": `${layout.tableRowTwoLine}px`,
  };
}

export function cssVariableText(mode: ColorMode = "light", selector = ":root") {
  const body = Object.entries(cssVariables(mode))
    .map(([key, value]) => `${key}:${value};`)
    .join("");
  return `${selector}{${body}color-scheme:${mode};}`;
}

/** antd 主题：与 CSS 变量同源。 */
export function themeConfig(variant: ThemeVariant = "admin", mode: ColorMode = "light"): ThemeConfig {
  const p = palette(mode);
  return {
    // 同页浏览器扩展可能也从 useId 的第一个值创建主题；显式命名避免变量样式相互覆盖。
    cssVar: { key: `open-platform-${variant}-${mode}` },
    algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: p.primary,
      colorInfo: p.primary,
      colorLink: p.primary,
      colorSuccess: status.success,
      colorWarning: status.warning,
      colorError: status.error,
      colorText: p.text,
      colorTextSecondary: p.textSecondary,
      colorTextTertiary: p.textTertiary,
      colorBorder: p.border,
      colorBorderSecondary: p.divider,
      colorSplit: p.divider,
      colorBgLayout: p.bgLayout,
      colorBgContainer: p.bgSurface,
      colorBgElevated: p.bgSurface,
      colorFillAlter: p.bgSubtle,
      controlItemBgActive: p.bgSelected,
      controlItemBgHover: p.bgHover,
      borderRadius: radius.md,
      borderRadiusSM: radius.sm,
      borderRadiusLG: radius.lg,
      fontFamily: typography.fontFamily,
      fontFamilyCode: typography.fontFamilyCode,
      fontSize: typography.size.md,
      fontSizeSM: typography.size.xs,
      fontSizeLG: typography.size.lg,
      fontSizeHeading1: typography.size.xxl,
      fontSizeHeading2: typography.size.xl,
      fontSizeHeading3: typography.size.lg,
      fontSizeHeading4: typography.size.md,
      fontSizeHeading5: typography.size.sm,
      lineHeight: typography.lineHeight.md / typography.size.md,
      controlHeight: control.md,
      controlHeightSM: control.sm,
      controlHeightLG: control.lg,
      motionDurationMid: "0.16s",
      wireframe: false,
    },
    components: {
      Table: {
        headerBg: p.bgSubtle,
        headerColor: p.textSecondary,
        headerSplitColor: "transparent",
        cellPaddingBlock: 7,
        cellPaddingInline: 12,
        cellPaddingBlockMD: 7,
        cellPaddingInlineMD: 12,
        cellPaddingBlockSM: 7,
        cellPaddingInlineSM: 10,
        rowHoverBg: p.bgHover,
        bodySortBg: p.bgSurface,
        headerSortActiveBg: p.bgSubtle,
        headerSortHoverBg: p.bgHover,
        rowSelectedBg: p.bgSelected,
        rowSelectedHoverBg: p.bgSelected,
        fontSize: typography.size.sm,
      },
      Tabs: { horizontalMargin: "0", titleFontSize: typography.size.md },
      Drawer: { paddingLG: space.xl },
      Menu: { itemHeight: 36, itemBorderRadius: radius.md, subMenuItemBorderRadius: radius.md },
      Tag: { defaultBg: p.bgSubtle },
      Button: { fontWeight: 500, primaryShadow: "none", defaultShadow: "none", dangerShadow: "none" },
      Tooltip: { fontSize: typography.size.xs },
      Form: { labelFontSize: typography.size.sm, verticalLabelPadding: "0 0 4px", itemMarginBottom: space.lg },
    },
  };
}
