import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";

/**
 * 112：把本次请求复制为调用开放平台网关的 cURL。Token 永远用占位符，不写入真实值；
 * 请求体按原文精度输出（大整数、高精度小数不舍入），单引号按 shell 规则转义。
 */
export function curlCommand(
  origin: string,
  identity: { service?: string; version?: string; method?: string },
  inputText: string,
): string {
  let body = inputText.trim() || "{}";
  try {
    body = stringifyJson(parseJson(body));
  } catch {
    /* 原文无效时照原文输出，便于看到问题。 */
  }
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  const url = `${origin}/api/oauth/${identity.service ?? "{service}"}/${identity.version ?? "{version}"}/${identity.method ?? "{method}"}`;
  return [
    `curl -X POST ${quote(url)}`,
    `  -H 'Authorization: Bearer <业务 Token>'`,
    `  -H 'Content-Type: application/json'`,
    `  --data-raw ${quote(body)}`,
  ].join(" \\\n");
}
