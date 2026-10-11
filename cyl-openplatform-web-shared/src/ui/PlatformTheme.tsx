import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useMemo, type ReactNode } from "react";
import { cssVariableText, themeConfig, type ColorMode, type ThemeVariant } from "./tokens";
import "./ui.css";

/**
 * 两端唯一主题入口：antd 主题与 CSS 变量同源生成（106 第 3 节）。
 */
export function PlatformTheme({
  children,
  variant = "admin",
  mode = "light",
}: {
  children: ReactNode;
  variant?: ThemeVariant;
  mode?: ColorMode;
}) {
  const theme = useMemo(() => themeConfig(variant, mode), [variant, mode]);
  const variables = useMemo(() => cssVariableText(mode), [mode]);
  return (
    <ConfigProvider locale={zhCN} theme={theme} button={{ autoInsertSpace: false, className: variant === "portal" ? "op-btn--portal" : undefined }}>
      <style data-op-tokens={`${variant}-${mode}`}>{variables}</style>
      <AntdApp component={false}>{children}</AntdApp>
    </ConfigProvider>
  );
}
