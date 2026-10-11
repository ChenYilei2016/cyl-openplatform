import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError } from "../access/api";
import { inspectDebugToken, type DebugToken } from "./tokenApi";

/**
 * 高级调试身份（业务 Token）的页面内存状态：粘贴 / 核验 / AK-Secret 获取 / 到期清除。
 * Token 只存在组件状态里，不写浏览器存储；到期或明确失效时调用 onInvalid 让页面整体清除。
 */
export function useTokenIdentity({ onInvalid, onError }: { onInvalid: (notice?: string) => void; onError: (message: string) => void }) {
  const [token, setToken] = useState("");
  const [identity, setIdentity] = useState<DebugToken | null>(null);
  const [form, setForm] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const live = useRef(token);
  live.current = token;
  const callbacks = useRef({ onInvalid, onError });
  callbacks.current = { onInvalid, onError };

  /** 中止进行中的核验并清空 Token 与身份。 */
  const reset = useCallback(() => {
    request.current?.abort();
    setVerifying(false);
    setToken("");
    setIdentity(null);
    setForm(false);
  }, []);
  const stopVerifying = useCallback(() => {
    request.current?.abort();
    setVerifying(false);
  }, []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!identity) return;
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => {
      const remaining = Date.parse(identity.expiresAt) - Date.now();
      if (remaining > 0) {
        timer = setTimeout(expire, Math.min(remaining, 2147483647));
        return;
      }
      callbacks.current.onInvalid("业务 Token 已到期，请重新准备身份；普通请求参数保留。");
    };
    expire();
    return () => clearTimeout(timer);
  }, [identity]);

  const verify = async () => {
    if (!token.trim()) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const fixed = token.trim();
    setVerifying(true);
    setNotice("正在核验业务身份…");
    try {
      const verified = await inspectDebugToken(fixed, controller.signal);
      if (!controller.signal.aborted && live.current.trim() === fixed) {
        setIdentity(verified);
        setNotice("");
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setNotice("");
        if (failure instanceof AdminApiError && failure.code === 40100003) callbacks.current.onInvalid();
        callbacks.current.onError((failure as Error).message);
      }
    } finally {
      if (!controller.signal.aborted) setVerifying(false);
    }
  };

  return { token, setToken, identity, setIdentity, form, setForm, verifying, notice, setNotice, reset, stopVerifying, verify };
}
export type TokenIdentityState = ReturnType<typeof useTokenIdentity>;
