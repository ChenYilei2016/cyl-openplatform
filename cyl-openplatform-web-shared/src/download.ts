/** 文档和SDK共用有界下载，先限制响应长度，再逐块限制实际正文。 */
export async function readBoundedBlob(response: Response, maxBytes: number, type: string): Promise<Blob> {
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('下载文件超过 2 MiB 限制。');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('下载正文为空。');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('下载文件超过 2 MiB 限制。');
      chunks.push(new Uint8Array(value));
    }
  } finally {
    try { await reader.cancel(); }
    catch { /* 已中断的流可能再次拒绝取消；保留原读取错误。 */ }
    finally { reader.releaseLock(); }
  }
  return new Blob(chunks, { type });
}
