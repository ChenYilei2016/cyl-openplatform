import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { decodeSigningSecret, hmacInputProblems, signHmacRequest, type HmacSigningInput } from './requestSigning';

const secret = Buffer.alloc(32, 7);
const input: HmacSigningInput = {
  path: '/context/api/sign/orders/v01/query', keyId: 'a'.repeat(32), tenantId: 'tenant-1', employeeNo: 'E1001',
  timestamp: '1700000000', nonce: 'b'.repeat(32), body: '{\n  "orderNo": "中文 COMMON-001",  "amount": 9007199254740993\n}', signingSecret: secret.toString('base64url'),
};

/** 独立实现（Node crypto），与浏览器 Web Crypto 结果交叉核对。 */
const reference = (value: HmacSigningInput) => {
  const canonical = ['SZ-HMAC-SHA256', 'POST', value.path, value.keyId, value.tenantId, value.employeeNo ?? '', value.timestamp, value.nonce,
    createHash('sha256').update(value.body, 'utf8').digest('hex')].join('\n');
  return { canonical, signature: createHmac('sha256', secret).update(canonical, 'utf8').digest('hex') };
};

test('规范串与签名与独立实现一致：中文、空白、大数、部署前缀，无人员时保留空行', async () => {
  for (const value of [input, { ...input, employeeNo: '' }]) {
    const result = await signHmacRequest(value);
    expect(result.canonical).toBe(reference(value).canonical);
    expect(result.signature).toBe(reference(value).signature);
    expect(result.headers.Authorization).toBe(`SZ-HMAC-SHA256 ${'a'.repeat(32)}:${result.signature}`);
  }
  const withoutEmployee = await signHmacRequest({ ...input, employeeNo: '' });
  expect(withoutEmployee.canonical.split('\n')).toHaveLength(9);
  expect(withoutEmployee.canonical.split('\n')[5]).toBe('');
  expect(withoutEmployee.headers).not.toHaveProperty('X-SZ-Employee');
  expect(hmacInputProblems(input)).toEqual([]);
});

test('SigningSecret 只接受规范 Base64URL 32 字节；格式问题逐项提示', async () => {
  expect(decodeSigningSecret(secret.toString('base64url'))).toEqual(new Uint8Array(secret));
  expect(decodeSigningSecret(secret.toString('base64'))).toBeUndefined();
  expect(decodeSigningSecret(secret.toString('base64url').slice(0, -1) + 'x')).toBeUndefined();
  await expect(signHmacRequest({ ...input, signingSecret: 'short' })).rejects.toThrow('43 字符');
  expect(hmacInputProblems({ ...input, path: '/api/sign/orders/v1/query?x=1', keyId: 'A'.repeat(32), tenantId: 'a b', timestamp: '1700000000000'.padStart(14, '0'), nonce: 'x' }))
    .toHaveLength(5);
  expect(hmacInputProblems({ ...input, path: '/a/../api/sign/orders/v1/query' })).toHaveLength(1);
});

const javac = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/javac') : 'javac';
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java';
const javaAvailable = Number((spawnSync(javac, ['-version'], { encoding: 'utf8' }).stdout?.match(/javac (\d+)/) ?? [])[1]) >= 17;

test.skipIf(!javaAvailable)('浏览器计算的签名通过网关 SignedRequest 验签，正文篡改后拒绝', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hmac-browser-'));
  try {
    writeFileSync(join(directory, 'VerifyBrowser.java'), `import io.github.chenyilei2016.openplatform.domain.signature.SignedRequest;
import java.util.Base64;
public class VerifyBrowser {
  public static void main(String[] args) {
    byte[] body = Base64.getDecoder().decode(args[6]);
    byte[] key = Base64.getUrlDecoder().decode(args[7]);
    String employee = args[3].isEmpty() ? null : args[3];
    if (!new SignedRequest(args[0], args[1], args[2], employee, Long.parseLong(args[4]), args[5], args[8], body).verifies(key)) throw new AssertionError("invalid");
    body[0] ^= 1;
    if (new SignedRequest(args[0], args[1], args[2], employee, Long.parseLong(args[4]), args[5], args[8], body).verifies(key)) throw new AssertionError("tamper accepted");
  }
}`);
    execFileSync(javac, ['-encoding', 'UTF-8', '-d', directory,
      resolve(process.cwd(), '../cyl-openplatform-domain/src/main/java/io/github/chenyilei2016/openplatform/domain/signature/SignedRequest.java'), join(directory, 'VerifyBrowser.java')]);
    for (const value of [input, { ...input, employeeNo: '' }]) {
      const { signature } = await signHmacRequest(value);
      execFileSync(java, ['-cp', directory, 'VerifyBrowser', value.path, value.keyId, value.tenantId, value.employeeNo ?? '', value.timestamp, value.nonce,
        Buffer.from(value.body, 'utf8').toString('base64'), value.signingSecret, signature]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
