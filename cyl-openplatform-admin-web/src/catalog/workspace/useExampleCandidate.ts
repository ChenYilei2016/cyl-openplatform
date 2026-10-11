import type { SchemaNode } from "@cyl/open-platform-web-shared/documentation/types";
import { useEffect, useRef, useState } from "react";
import type { AdminApi } from "../../access/api";

export interface ExampleCandidate {
  schema: SchemaNode;
  schemaText: string;
  source: unknown;
}

/**
 * 公开响应示例候选：先由服务端严格校验当前响应结构，再打开示例编辑；
 * 校验期间结构已变化或请求被取消（重开、卸载）时不打开，迟到结果不能覆盖。
 */
export function useExampleCandidate({ api, responseSchemaText, onError }: { api: AdminApi; responseSchemaText: string; onError: (message: string) => void }) {
  const [candidate, setCandidate] = useState<ExampleCandidate | null>(null);
  const latestText = useRef(responseSchemaText);
  latestText.current = responseSchemaText;
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const open = async (source?: unknown) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const schemaText = responseSchemaText;
    try {
      const schema = await api<SchemaNode>("/apis/validate-json?kind=schema&request=false", { method: "POST", bodyText: schemaText, signal: controller.signal });
      if (!controller.signal.aborted && latestText.current === schemaText) setCandidate({ schema, schemaText, source: source === undefined ? schema.example : source });
    } catch (failure) {
      if (!controller.signal.aborted) onError(`请先修正当前响应结构：${(failure as Error).message}`);
    }
  };
  return { candidate, open, clear: () => setCandidate(null) };
}
