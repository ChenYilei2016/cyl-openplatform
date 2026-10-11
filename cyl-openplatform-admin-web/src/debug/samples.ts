import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { withoutSecrets } from "./RequestEditor";

/** 112：常用调试参数样例，按 API 存在浏览器本地；保存前移除 Token / Secret 等秘密字段。 */
export interface DebugSample {
  name: string;
  input: string;
  savedAt: number;
}
const key = (apiId: string) => `op-debug-samples:${apiId}`;
export const MAX_SAMPLES = 20;

export function readSamples(apiId: string): DebugSample[] {
  try {
    const value = parseJson<DebugSample[]>(window.localStorage.getItem(key(apiId)) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item?.name === "string" && typeof item.input === "string") : [];
  } catch {
    return [];
  }
}

function write(apiId: string, samples: DebugSample[]) {
  try {
    window.localStorage.setItem(key(apiId), stringifyJson(samples));
  } catch {
    /* 存储不可用时只是不保存样例。 */
  }
}

/** 同名覆盖并移到最前；超过上限丢弃最旧的。返回保存后的列表。 */
export function saveSample(apiId: string, name: string, input: string): DebugSample[] {
  const sample = { name: name.trim(), input: withoutSecrets(input), savedAt: Date.now() };
  const next = [sample, ...readSamples(apiId).filter((item) => item.name !== sample.name)].slice(0, MAX_SAMPLES);
  write(apiId, next);
  return next;
}

export function removeSample(apiId: string, name: string): DebugSample[] {
  const next = readSamples(apiId).filter((item) => item.name !== name);
  write(apiId, next);
  return next;
}
