import { useState } from "react";

/** 仅在当前登录身份内存保留发布/审核输入；不将备注写入URL或浏览器存储。 */
export function usePublicationNote(
  notes: Map<string, string> | undefined,
  key: string,
  initial = "",
) {
  const [draft, setDraft] = useState({
    notes,
    key,
    value: notes?.get(key) ?? initial,
  });
  const value =
    draft.notes === notes && draft.key === key
      ? draft.value
      : (notes?.get(key) ?? initial);
  const change = (next: string) => {
    setDraft({ notes, key, value: next });
    if (next) notes?.set(key, next);
    else notes?.delete(key);
  };
  return [value, change] as const;
}
