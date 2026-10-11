import { useEffect, useState, type RefObject } from "react";

/**
 * 按字段路径定位：找到最长匹配的 [data-field-path] 元素，展开所在折叠区并聚焦；
 * 结构示例 / 默认值 / 枚举的问题打开对应行的值编辑。只在配置页可见时执行。
 */
export function useFieldFocus(formRef: RefObject<HTMLFormElement | null>, active: boolean) {
  const [focusPath, setFocusPath] = useState<string | null>(null);
  useEffect(() => {
    if (!focusPath || !active) return;
    const frame = requestAnimationFrame(() => {
      const locations = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[data-field-path]") ?? []);
      const location = locations
        .filter((element) => focusPath === element.dataset.fieldPath || focusPath.startsWith(element.dataset.fieldPath + "/"))
        .sort((a, b) => (b.dataset.fieldPath?.length ?? 0) - (a.dataset.fieldPath?.length ?? 0))[0];
      for (let ancestor: HTMLElement | null = location ?? null; ancestor; ancestor = ancestor.parentElement)
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      const valueKind = focusPath.slice((location?.dataset.fieldPath?.length ?? 0) + 1).split("/")[0];
      const valueEditor = location?.querySelector<HTMLButtonElement>("[data-schema-values]");
      if (valueEditor && ["example", "defaultValue", "enumValues"].includes(valueKind)) {
        if (valueEditor.getAttribute("aria-expanded") !== "true") valueEditor.click();
        const section = valueEditor.closest("section");
        requestAnimationFrame(() => section?.querySelector<HTMLTextAreaElement>(`[data-schema-value="${valueKind}"]`)?.focus());
        setFocusPath(null);
        return;
      }
      const target = location?.matches("input,textarea,select") ? location : location?.querySelector<HTMLElement>("input:not([type=hidden]),textarea,select,button");
      (target ?? location)?.focus();
      location?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      setFocusPath(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, focusPath]);
  return { focusPath, setFocusPath };
}
