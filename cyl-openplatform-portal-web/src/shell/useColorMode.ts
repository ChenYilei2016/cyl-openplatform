import { useEffect, useState } from "react";
import type { ColorMode } from "@cyl/open-platform-web-shared/ui/tokens";

export type ColorPreference = "system" | ColorMode;
const STORAGE_KEY = "op-portal-color-mode";

const systemMode = (): ColorMode => (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const readPreference = (): ColorPreference => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
};

/** 门户浅色/深色：默认跟随系统；用户选择保存在本机（只是显示偏好，无隐私信息）。 */
export function useColorMode() {
  const [preference, setPreferenceState] = useState<ColorPreference>(readPreference);
  const [system, setSystem] = useState<ColorMode>(systemMode);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const update = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  const setPreference = (next: ColorPreference) => {
    setPreferenceState(next);
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 存储不可用时只在本次页面生效。 */
    }
  };
  return { preference, mode: preference === "system" ? system : preference, setPreference };
}

/** 系统“减少动态效果”：开启时不渲染装饰动效（信息保持完整）。 */
export function useReducedMotion() {
  const query = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [reduced, setReduced] = useState(query);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
