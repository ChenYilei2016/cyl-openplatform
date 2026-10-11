import { useEffect, useRef, useState } from "react";
import { changedFields, clearStash, readStash, writeStash, type DraftContent, type DraftStash } from "./draftModel";

/**
 * 未保存修改的本地暂存（sessionStorage，按 apiId + 已保存修订分键）：
 * 有修改时最多每 5 秒写一次；打开时若存在与已保存内容不同的暂存，交由页面提示恢复或丢弃。
 * storageKey 为 null（尚未创建的草稿没有服务端修订）时不读写暂存。
 */
export function useDraftStash({ storageKey, initial, content, dirty, apply }: { storageKey: string | null; initial: DraftContent; content: DraftContent; dirty: boolean; apply: (content: DraftContent) => void }) {
  const [offer, setOffer] = useState<DraftStash | null>(() => {
    if (!storageKey) return null;
    const stash = readStash(storageKey);
    return stash && changedFields(stash.content, initial).length ? stash : null;
  });
  const [stashedAt, setStashedAt] = useState<number | null>(null);
  const latest = useRef(content);
  latest.current = content;
  const timer = useRef<number | undefined>(undefined);
  const contentKey = JSON.stringify(content);
  useEffect(() => {
    if (!storageKey || !dirty || timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      writeStash(storageKey, latest.current);
      setStashedAt(Date.now());
    }, 5000);
  }, [contentKey, dirty, storageKey]);
  // 离开页面时把最后不足 5 秒的输入也写出去。
  useEffect(
    () => () => {
      if (!storageKey || timer.current === undefined) return;
      window.clearTimeout(timer.current);
      writeStash(storageKey, latest.current);
    },
    [storageKey],
  );
  const cancelPending = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  return {
    offer,
    stashedAt,
    restore: () => {
      if (!offer) return;
      apply(offer.content);
      setStashedAt(offer.savedAt);
      setOffer(null);
    },
    discard: () => {
      if (storageKey) clearStash(storageKey);
      setOffer(null);
    },
    /** 保存成功或主动放弃后清除暂存与待写入。 */
    clear: () => {
      cancelPending();
      if (storageKey) clearStash(storageKey);
      setStashedAt(null);
    },
  };
}
