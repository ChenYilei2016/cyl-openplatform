import { ArrowRightOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import CodeBlock from '../shell/CodeBlock';
import MethodBadge from '../shell/MethodBadge';
import { guideExamples, okhttpCoordinates, runCommands, tokenResponse } from './guideExamples';
import HmacSignatureDemo from './HmacSignatureDemo';
import './guide.css';

/**
 * 接入指南（115 用户故事 14–15）。首页三步流程与其他页面按稳定锚点进入：
 * `#credential` 获取凭据、`#token` 换取 Token、`#invoke` 发起调用、`#signature` 签名调用。
 */
const topics = [
  { id: 'guide-start', title: '快速接入', summary: '按时间线完成第一次调用：获取凭据 → 换取 Token → 发起调用；已有签名凭据时也可直接签名调用。', sections: [
    ['credential', '获取凭据'], ['token', '换取 Token'], ['invoke', '发起调用'], ['signature', '签名调用（可选）'], ['guide-user-token', '用户级 Token 与人员委托'], ['token-lifecycle', 'Token 续期与管理'],
  ] },
  { id: 'guide-reference', title: '接口约定与排障', summary: '统一请求与响应、常见错误，以及调用前后需要核对的事项。', sections: [
    ['guide-response', '请求与响应约定'], ['guide-errors', '错误码与排障'], ['guide-faq', '常见问题'],
  ] },
  { id: 'guide-sdk', title: 'SDK 与工具', summary: '优先使用 OkHttp 接入 Java，也可使用 cURL / Postman 或平台 SDK。', sections: [
    ['sdk-download', '添加依赖'], ['sdk-java', '运行 Java 示例'], ['sdk-tools', 'cURL 与 Postman'], ['sdk-client', '客户端使用建议'], ['sdk-platform', '平台 SDK（可选）'], ['guide-updates', '版本与更新记录'],
  ] },
] as const;
/** 旧锚点继续可用（API 文档、我的接入等仍可能链接）：映射到新的步骤锚点。 */
const legacyAnchors: Record<string, string> = { 'guide-identity': 'credential', 'bearer-guide': 'token', 'token-call': 'invoke', 'hmac-guide': 'signature' };
const resolveAnchor = (hash: string) => legacyAnchors[hash] ?? hash;
/** 步骤内的小节锚点，归属于所在主题。 */
const innerAnchors: Record<string, string> = { 'token-result': 'guide-start' };
type Topic = (typeof topics)[number];
const topicOf = (hash: string): Topic | undefined => {
  const id = resolveAnchor(hash);
  return topics.find((topic) => topic.id === id || topic.sections.some(([section]) => section === id) || innerAnchors[id] === topic.id);
};

const errors = [
  ['400', '40000001', '请求参数不合法', '核对必填字段、类型和 JSON 格式。'],
  ['401', '40100001–40100004', '身份或凭据无效', '管理操作核对平台登录；业务调用核对 AK、Token 或签名，Token 失效后重新签发。'],
  ['403', '40300001', '权限不足', '核对应用、租户授权、权限组及人员委托。'],
  ['404 / 405', '40400001 / 40500001', '资源或请求方法不匹配', '核对部署基地址、服务、外部版本、操作以及 POST 方法；确认 API 已生效并启用。'],
  ['409 / 410', '40900001 / 41000001', '状态变化 / 版本退役', '状态变化后刷新重试；版本退役时按维护与迁移说明切换外部版本。'],
  ['413 / 415', '41300001 / 41500001', '正文过大 / 媒体类型不支持', '缩小请求正文，按接口契约使用 Content-Type: application/json。'],
  ['429', '42900001', '请求过于频繁', '降低请求频率；核对业务状态后按接入方重试策略处理。'],
  ['502', '50200002', '提供方业务拒绝', '请求已到达提供方但未满足其业务成功规则；联系接口维护者核对业务条件。'],
  ['500 / 502 / 503 / 504', '50000001 / 50200001 / 50300001 / 50400001', '服务异常、依赖不可用或超时', '保留 requestId 并联系维护者。超时不等于业务回滚，重新调用前先核对执行结果。'],
];

const responseExample = `{
  "code": 200,
  "resultMsg": "成功",
  "data": { "业务字段": "以所选 API 契约为准" },
  "requestId": "<本次请求标识>"
}`;

/** 可选步骤可收起：收起时只占一行（标题、一句摘要、展开按钮），展开后为完整步骤（锚点进入时由调用方展开）。 */
function Step({ id, index, title, optional, summary, open = true, onToggle, children }: { id: string; index: number; title: string; optional?: boolean; summary?: ReactNode; open?: boolean; onToggle?: () => void; children: ReactNode }) {
  const collapsed = !!onToggle && !open;
  const toggle = onToggle && (
    <Button size="small" type={collapsed ? 'link' : 'default'} icon={open ? <UpOutlined aria-hidden /> : <DownOutlined aria-hidden />} iconPlacement="end" aria-expanded={open} aria-controls={`${id}-content`} onClick={onToggle}>
      {open ? `收起${title}` : '展开'}
    </Button>
  );
  return (
    <li className={`op-guide-step${optional ? ' op-guide-step--optional' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <span className="op-guide-step__marker" aria-hidden>{optional ? '+' : index}</span>
      <section id={id} tabIndex={-1} className="op-guide-step__body" aria-labelledby={`${id}-title`}>
        {collapsed ? (
          <div className="op-guide-step__compact">
            <h2 id={`${id}-title`}>{title}</h2>
            <span className="op-guide-step__tag">{optional ? '可选' : `第 ${index} 步`}</span>
            {summary && <p>{summary}</p>}
            {toggle}
          </div>
        ) : (
          <>
            <p className="op-guide-step__eyebrow">{optional ? '可选方式' : `第 ${index} 步`}</p>
            <h2 id={`${id}-title`}>{title}</h2>
            {toggle && <div className="op-guide-step__toggle">{toggle}</div>}
          </>
        )}
        <div id={`${id}-content`} hidden={!open}>{children}</div>
      </section>
    </li>
  );
}

const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <div className="op-guide-table">
    <table>
      <thead><tr>{head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

export default function IntegrationGuide({ gatewayBaseUrl }: { gatewayBaseUrl: string }) {
  const [employeeToken, setEmployeeToken] = useState(false);
  const examples = guideExamples(gatewayBaseUrl, employeeToken);
  const [hash, setHash] = useState(() => location.hash.slice(1));
  // 签名调用是可选方式，默认收起；从锚点（含旧 #hmac-guide）进入时展开。
  const [signatureOpen, setSignatureOpen] = useState(() => resolveAnchor(location.hash.slice(1)) === 'signature');
  useEffect(() => {
    if (resolveAnchor(hash) === 'signature') setSignatureOpen(true);
  }, [hash]);
  const topic = topicOf(hash) ?? topics[0];
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const restore = () => {
      const next = location.hash.slice(1);
      if (!next || topicOf(next)) setHash(next);
    };
    window.addEventListener('hashchange', restore);
    window.addEventListener('popstate', restore);
    // 首页三步在切换页面后的下一帧才写入 hash（可能用 pushState，不触发 hashchange）：挂载后再核对一次。
    const frame = requestAnimationFrame(restore);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', restore); window.removeEventListener('popstate', restore); };
  }, []);
  const focusAnchor = (id: string) => {
    const target = id === topic.id ? heading.current : document.getElementById(resolveAnchor(id));
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'start' });
  };
  useEffect(() => {
    if (topicOf(hash)) focusAnchor(hash);
  }, [hash, topic.id]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const sections = topic.sections.map(([id]) => document.getElementById(id)).filter((element): element is HTMLElement => !!element);
      const atBottom = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      const current = atBottom ? sections.at(-1) : sections.filter((element) => element.getBoundingClientRect().top <= 150).at(-1) ?? sections[0];
      setActiveSection(current?.id ?? '');
    };
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [topic]);
  const navigate = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setDirectoryOpen(false);
    if (hash === id) {
      requestAnimationFrame(() => focusAnchor(id));
      return;
    }
    history.pushState(null, '', `${location.pathname}${location.search}#${id}`);
    setHash(id);
  };
  const anchor = (id: string, children: ReactNode) => <a href={`#${id}`} onClick={(event) => navigate(event, id)}>{children}</a>;
  const gateway = gatewayBaseUrl ? <code>{gatewayBaseUrl}</code> : <span className="op-guide-placeholder">未读取到网关地址：示例使用环境变量 OPEN_PLATFORM_BASE_URL，请向平台维护者确认环境与地址。</span>;
  return (
    <div className="op-guide">
      <aside className={`op-guide-directory${directoryOpen ? ' is-open' : ''}`}>
        <button className="op-guide-toggle" type="button" aria-expanded={directoryOpen} aria-controls="guide-directory-links" onClick={() => setDirectoryOpen(!directoryOpen)}>
          文档目录 <span>{directoryOpen ? '收起' : '展开'}</span>
        </button>
        <nav id="guide-directory-links" aria-label="接入指南主题">
          <p className="op-guide-directory__title">接入指南</p>
          {topics.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={topic.id === item.id ? 'page' : undefined} onClick={(event) => navigate(event, item.id)}>{item.title}</a>)}
          <div className="op-guide-directory__more"><a href="?section=documents">API 文档 ↗</a><a href="?section=sdk">Java SDK 中心 ↗</a></div>
        </nav>
      </aside>
      <article className="op-guide-content">
        <header className="op-guide-heading">
          <p className="op-guide-heading__eyebrow">INTEGRATION GUIDE</p>
          <h1 ref={heading} tabIndex={-1}>{topic.title}</h1>
          <p>{topic.summary}</p>
        </header>
        <div id={topic.id} className="op-guide-body">
          {topic.id === 'guide-start' && <>
            <nav className="op-guide-journey" aria-label="接入步骤">
              {[['credential', '获取凭据'], ['token', '换取 Token'], ['invoke', '发起调用']].map(([id, title], index) => (
                <a key={id} href={`#${id}`} onClick={(event) => navigate(event, id)}><span>{index + 1}</span>{title}{index < 2 && <ArrowRightOutlined aria-hidden />}</a>
              ))}
              <a className="op-guide-journey__optional" href="#signature" onClick={(event) => navigate(event, 'signature')}><span>+</span>签名调用（可选）</a>
            </nav>
            <p className="op-guide-note"><strong>推荐 Bearer Token</strong>：用 AK 和 AppSecret 换取调用凭证，再带着它访问 API。平台登录仅用于管理凭据，不能替代业务 Token。</p>
            <ol className="op-guide-timeline">
              <Step id="credential" index={1} title="获取凭据">
                <p>打开 <a href="?section=settings">我的接入</a>，使用平台账号登录。页面顶部“当前租户”后面的值就是租户 ID。点击“生成新 AK” → 填写本租户备注（可选） → “生成并绑定本租户”，保存返回的 AK 与本次 AppSecret。</p>
                <Table head={['需要准备', '获取方式', '填写到哪里']} rows={[
                  ['网关基地址', gateway, '请求 URL 的前缀；有路径前缀时一并保留'],
                  ['AK / AppSecret', '我的接入中创建后保存，或从团队安全配置获取；已有 Secret 不会在列表再次显示。', <code key="c">appKey / appSecret</code>],
                  ['租户 ID', '复制我的接入页顶部“当前租户”的 ID；团队已有 AK 时先点“绑定现有 AK”关联本租户。', <><code>tenantId</code>，字符串</>],
                ]} />
                <p className="op-guide-caption">AK 必须关联目标租户，并具有目标 API 要求的权限组。申请 Token 不会自动增加权限。无个人业务上下文时使用应用级 Token；代表具体员工执行业务时使用{anchor('guide-user-token', '用户级 Token')}。</p>
                <CodeBlock title="安全运行配置（Shell）" samples={[{ label: 'Shell', language: 'bash', code: examples.environment }]} />
              </Step>
              <Step id="token" index={2} title="换取 Token">
                <p>向下面地址发送一次 POST 请求，正文选择 JSON，先选择本次需要的调用身份。获取 Token 时还不需要 Bearer。</p>
                <dl className="op-guide-endpoint">
                  <div><dt>请求</dt><dd><MethodBadge method="POST" /> <code>{gatewayBaseUrl || '<网关基地址>'}/api/token</code></dd></div>
                  <div><dt>Content-Type</dt><dd><code>application/json</code></dd></div>
                </dl>
                <fieldset className="op-guide-choice">
                  <legend>调用身份</legend>
                  <label><input type="radio" name="guide-token-kind" checked={!employeeToken} onChange={() => setEmployeeToken(false)} />应用级 Token（不指定员工）</label>
                  <label><input type="radio" name="guide-token-kind" checked={employeeToken} onChange={() => setEmployeeToken(true)} />用户级 Token（代表已获委托的员工）</label>
                </fieldset>
                <Table head={['字段', '必填 / 类型', '说明']} rows={[
                  [<code key="k">appKey</code>, '是 · string', 'AK，32 位小写十六进制字符串。'],
                  [<code key="s">appSecret</code>, '是 · string', '与该 AK 配套的 AppSecret，最多 128 字符。'],
                  [<code key="t">tenantId</code>, '是 · string', '已授权的租户 ID，最多 64 字符。数字形式也要加双引号。'],
                  ...(employeeToken ? [[<code key="e">employeeNo</code>, '是 · string', '员工工号，最多 64 字符。先完成人员委托；不要填写账号 ID 或人员 ID 代替工号。']] : []),
                ]} />
                <CodeBlock title="获取 Token" samples={examples.tokenSamples} initialLabel="cURL" />
                <p className="op-guide-caption">将占位符替换为实际值，保留双引号、不要保留尖括号。cURL 适用于 macOS / Linux Shell，凭据文件仅在本机安全保存，不提交到代码仓库。</p>
                <details className="op-guide-details">
                  <summary>Postman：按界面填写</summary>
                  <ol><li>新建 HTTP 请求，方法选择 <strong>POST</strong>，URL 填“网关基地址 + /api/token”。</li><li>Authorization 选择 <strong>No Auth</strong>；获取 Token 时还不需要 Bearer。</li><li>Body 选择 <strong>raw → JSON</strong>，粘贴请求 JSON 并替换占位符。</li><li>检查 Content-Type 为 application/json，点击 <strong>Send</strong>，按下面读取响应。</li></ol>
                </details>
                <details className="op-guide-details">
                  <summary>已有 Token 的复用参数</summary>
                  <p><code>existingToken</code>：可选 string，最多 128 字符。验证并复用相同主体的有效 Token，不延长有效期；失效或主体不符会拒绝。首次获取时省略。</p>
                </details>
                <h3 id="token-result" tabIndex={-1}>读取返回的 Token</h3>
                <p>HTTP 状态为 <strong>200</strong> 且 <code>code = 200</code> 表示成功。找到 <strong>data.accessToken</strong>，复制它的值（不含双引号），下一步用作 Bearer Token。</p>
                <CodeBlock title="成功响应" samples={[{ label: 'JSON', language: 'json', code: tokenResponse(employeeToken) }]} />
                <dl className="op-guide-fields">
                  <div><dt>accessToken</dt><dd>真正用于调用的 Token；妥善保存并复用，不要每次请求都重新生成。</dd></div>
                  <div><dt>tokenType</dt><dd>认证类型 Bearer，拼入请求头时与 Token 之间保留一个空格。</dd></div>
                  <div><dt>expiresAt / expiresIn</dt><dd>实际 UTC 到期时间 / 剩余秒数；示例数值不代表固定有效期。</dd></div>
                  <div><dt>context / requestId</dt><dd>调用身份与请求排障信息。context 示例仅列部分字段；其中 tokenId 是记录号，不能替代 accessToken。</dd></div>
                </dl>
                <p>未成功时先检查：400 看必填与 JSON 格式，401 看 AK / Secret，403 看租户关联与授权。保留 requestId，前往{anchor('guide-errors', '错误码与排障')}核对。</p>
              </Step>
              <Step id="invoke" index={3} title="发起调用">
                <p>从 <a href="?section=documents">API 文档</a>选择接口，复制它的请求路径与业务示例。下面以查询订单为例，请替换为你实际有权限的接口；示例通过 OPEN_PLATFORM_TOKEN 读取上一步的 accessToken。</p>
                <CodeBlock title="调用业务接口" samples={examples.invokeSamples} />
                <p><strong>Postman：</strong>新建 POST 请求，填写完整业务 URL；Authorization 选择 <strong>Bearer Token</strong>，Token 框只粘贴刚才的 accessToken。Body 仍选 raw → JSON，填写该接口的业务参数，然后 Send。</p>
                <p className="op-guide-note">完成标志：HTTP 与 code 均成功，并在 data 中得到预期业务结果。请求失败时按 requestId 排查；Token 不放在正文里，也不与 HMAC 签名混用。Java 需要先{anchor('sdk-download', '添加 OkHttp 依赖')}。</p>
              </Step>
              <Step id="signature" index={4} title="签名调用" optional open={signatureOpen} onToggle={() => setSignatureOpen((value) => !value)}
                summary="已有管理员单独发放的 keyId 与 SigningSecret 时可选；新接入优先使用上面的 Token 流程。">
                <p>已有独立签名凭据时可选此方式，不需要先获取 Token。新接入继续优先使用上面的 Token 流程。HMAC 使用管理员单独发放的 keyId 与 SigningSecret，不能用 AK / AppSecret 代替。</p>
                <ol className="op-guide-list">
                  <li><strong>设置环境变量：</strong>由运行配置提供 OPEN_PLATFORM_KEY_ID、OPEN_PLATFORM_SIGNING_SECRET、OPEN_PLATFORM_TENANT_ID；需要人员身份时提供 OPEN_PLATFORM_EMPLOYEE_NO 并先建立委托。{!gatewayBaseUrl && '另需配置 OPEN_PLATFORM_BASE_URL。'}</li>
                  <li><strong>编译运行：</strong>加入 OkHttp 依赖，将示例保存为 HmacExample.java，在已有 Maven 项目目录中执行运行命令。实际接入请复制对应 API 文档的示例。</li>
                  <li><strong>核对结果：</strong>HTTP 状态与响应 JSON 中的 code 均为 200 才表示调用成功，再读取 data。示例只输出 HTTP 状态，不打印业务正文；签名后不要修改路径或正文。</li>
                </ol>
                <CodeBlock title="HmacExample.java · JDK 8+ / OkHttp" samples={examples.signatureSamples} maxHeight={480} />
                <details className="op-guide-details">
                  <summary>Maven 依赖与编译运行命令 · JDK 8+</summary>
                  <CodeBlock title="OkHttp 依赖" samples={okhttpCoordinates} />
                  <CodeBlock title="编译运行" samples={[{ label: 'Shell', language: 'bash', code: runCommands('HmacExample') }]} />
                  <p className="op-guide-caption">Windows classpath 分隔符使用分号；凭据通过环境变量注入，不写入源码。</p>
                </details>
                <p>签名规则：时间戳为 UTC 秒，nonce 每次随机生成，路径包含部署前缀；JDK 标准库生成签名，OkHttp 发送同一份原始 UTF-8 正文，请求不另携带 Bearer Token。也可使用{anchor('sdk-platform', '平台 SDK 签名模式')}。下面的计算器使用同一套规则，可对照自己的实现逐项核对。</p>
                <HmacSignatureDemo gatewayBaseUrl={gatewayBaseUrl} />
              </Step>
            </ol>
            <section id="guide-user-token" tabIndex={-1} className="op-guide-section">
              <h2>用户级 Token 与人员委托</h2>
              <p>用户级 Token（页面中也称“人员 Token”）代表已获委托的具体员工。涉及“我的订单”、个人数据或需要记录业务操作者的接口时使用；接口明确要求员工身份时，应用级 Token 不能替代。</p>
              <ol className="op-guide-list"><li>进入“我的接入”，在凭据行点击<strong>配置调用员工</strong>。</li><li>按姓名选择或输入工号，核验平台人员身份后建立委托。有效同租户员工可代办，不要求目标本人另行确认。</li><li>在该员工行点击<strong>获取人员 Token</strong>，租户、AK 与工号会自动带入；填写 Secret 并获取 Token。</li><li>复制 accessToken 用于代码调用，或在当前页选择授权 API 文档继续联调。</li></ol>
              <p>人员委托只确定“代表谁”，不会增加凭据权限，也不会绕过提供方的个人数据权限。本人使用也需有效委托；平台已登录不等于已取得业务 Token。</p>
              <details className="op-guide-details"><summary>人员 Token 的隔离、缓存与失效</summary><p>按凭据、租户、员工分别缓存 Token，不能把甲员工 Token 复用给乙员工。撤销该人员委托后，其旧 Token 会失效；重新建立委托仍需重新获取，不会复活旧 Token。撤销单个人员不影响其他人员或应用级 Token；解绑租户会使该关系派生的 Token 都失效。</p><p>employeeNo 由请求指定，userId / employeeId 由服务端核验得到；业务正文不能覆盖认证身份。</p></details>
            </section>
            <section id="token-lifecycle" tabIndex={-1} className="op-guide-section">
              <h2>Token 续期与管理</h2>
              <p>在可信应用内缓存并复用有效 Token，无需每次业务调用都重新签发。不传 existingToken 的签发请求会生成新 Token，请集中管理并避免并发刷新。</p>
              <Table head={['操作', '请求', '结果与使用时机']} rows={[
                ['检查身份', <><code>POST /api/token/introspect</code><br />Bearer + 空正文或 {'{}'}</>, 'data 返回当前 Token 上下文；不能通过正文修改租户或人员。'],
                ['刷新', <><code>POST /api/token/refresh</code><br />旧的有效 Bearer + JSON appKey / appSecret</>, '生成新 Token并撤销旧 Token，没有并行使用宽限期。更新安全配置及客户端实例后再继续调用；已过期 Token 应重新签发。'],
                ['撤销当前 Token', <><code>POST /api/token/revoke</code><br />Bearer + 空正文或 {'{}'}</>, '只撤销当前 Token；重复撤销可能返回无效 Token，不视为新的成功撤销。'],
              ]} />
              <p className="op-guide-note">后台编辑 API 的“测试”步骤可就近用 AK / Secret 获取 Token。获取只准备身份；点击“执行测试”才会真实调用。当前测试页可以复用，离开步骤后清理 Token，保留同 API 的测试 JSON。</p>
            </section>
          </>}
          {topic.id === 'guide-reference' && <>
            <section id="guide-response" tabIndex={-1} className="op-guide-section op-guide-section--first">
              <h2>统一调用约定</h2>
              <p>业务接口使用 POST 和 JSON，Token 放入 Authorization 请求头。请求中的字段、必填项、默认值、枚举和返回 data 结构，以所选 API 外部版本文档为准。</p>
              <CodeBlock title="业务请求" samples={[{ label: 'HTTP', language: 'text', code: examples.bearerRequest }]} />
              <Table head={['项目', '约定']} rows={[
                ['请求头', 'Token 方式使用 Authorization: Bearer <TOKEN>；正文使用 Content-Type: application/json。'],
                ['业务正文', '发送原始 JSON 对象，字段名区分大小写。租户/员工由可信认证上下文提供，不能在正文里伪造。'],
                ['精确值', 'ID 使用字符串。大整数和高精度金额应按契约及所用语言的精度能力处理，避免先经过 JavaScript Number 再序列化造成舍入。'],
                ['时间', '按 API 字段约定传日期/时区；HMAC 时间戳使用 UTC 秒，不能传毫秒。'],
              ]} />
              <h2>公共响应格式</h2>
              <p className="op-guide-note"><strong>code = 200 表示本次 API 调用成功；code ≠ 200 表示调用失败。</strong>即使 HTTP 状态为 200，也要检查响应中的 code；不要通过 resultMsg 是否等于“成功”来判断。</p>
              <CodeBlock title="公共响应" samples={[{ label: 'JSON', language: 'json', code: responseExample }]} />
              <Table head={['响应字段', '类型', '说明']} rows={[
                [<code key="c">code</code>, 'integer', '调用结果码。200 为成功，其他值按错误码处理。'],
                [<code key="r">resultMsg</code>, 'string', '结果说明，供阅读和排障；文案可能变化，不作为程序判断条件。'],
                [<code key="d">data</code>, '按接口定义', '业务返回值；失败时为 null。订单状态等业务含义以具体接口定义为准。'],
                [<code key="q">requestId</code>, 'string', '本次请求标识，联系支持人员时可用于定位问题。'],
              ]} />
              <p>调用时先检查 HTTP 状态：非 200 按失败处理；HTTP 200 时继续检查 code。API 页面上方保留字段结构；下方示例可切换 data 业务 JSON 或包含上述公共字段的完整响应。</p>
            </section>
            <section id="guide-errors" tabIndex={-1} className="op-guide-section">
              <h2>公共错误码与排障</h2>
              <Table head={['HTTP', '平台结果码', '含义', '处理建议']} rows={errors.map(([status, code, meaning, action]) => [status, <code key="c">{code}</code>, meaning, action])} />
              <h3>按这个顺序检查</h3>
              <ol className="op-guide-list"><li>核对网关环境、服务/外部版本/操作和请求方法。</li><li>401 核对 Token 或签名；403 核对租户关联、权限组和人员委托。</li><li>核对业务 JSON 必填、类型和枚举，再根据 requestId 查看调用记录。</li><li>超时、取消或网络错误先确认业务是否已执行；写操作按业务幂等约定处理，不能直接无限重试。</li></ol>
              <p>联系维护者时提供请求号、发生时间、环境、接口及错误码。不要附带 Secret、完整 Token 或未脱敏个人数据。</p>
            </section>
            <section id="guide-faq" tabIndex={-1} className="op-guide-section op-guide-faq">
              <h2>常见问题</h2>
              <details open><summary>平台已登录，为什么调用还需要 Token？</summary><p>平台会话用于管理接入资格，业务 Token 用于独立调用身份。公开文档和平台 SDK 无需登录；业务调用必须认证。</p></details>
              <details><summary>AppSecret 没保存或忘记了怎么办？</summary><p>创建后只交付一次，不能从列表恢复。先查团队安全配置或联系维护者处理凭据；若上次创建结果未知，先刷新核对，避免反复生成。</p></details>
              <details><summary>重新绑定 AK，会恢复旧 Token 吗？</summary><p>不会。解绑撤销本租户关系及相关 Token 的有效性，重新绑定后需要重新获取 Token；不影响其他租户的独立关联。</p></details>
              <details><summary>能用 AppSecret 直接做 HMAC 吗？</summary><p>不能。HMAC 使用独立 SigningSecret 和 keyId，由管理员单独发放。一次请求只使用一种认证方式。</p></details>
              <details><summary>文档能打开，但接口调用失败？</summary><p>公开阅读不表示已有调用权限。检查 API 是否生效且启用、版本是否已退役，以及凭据、租户授权、权限组和人员委托。</p></details>
              <details><summary>更新 SDK 会自动升级 API 吗？</summary><p>不会。SDK 版本与 API 外部版本独立；按接口变更说明选择版本，并先在目标环境验证业务请求。</p></details>
              <details><summary>请求超时，可以立即再发一次吗？</summary><p>先确认业务执行结果。超时不代表回滚，签名 nonce 也可能已消费；SDK 不会自动重试，重复写入风险需要业务幂等处理。</p></details>
            </section>
          </>}
          {topic.id === 'guide-sdk' && <>
            <p className="op-guide-note">Java 接入推荐 <strong>OkHttp + Bearer Token</strong>，兼容 JDK 8。添加依赖，填写 Token 和业务参数，即可按示例调用 API。</p>
            <section id="sdk-download" tabIndex={-1} className="op-guide-section op-guide-section--first">
              <h2>1. 添加依赖</h2>
              <p>将下面依赖加入项目。OkHttp 是通用 HTTP 客户端，本平台使用它作为推荐 Java 接入方式，无需先下载平台 SDK。</p>
              <CodeBlock title="OkHttp 依赖 · JDK 8+" samples={okhttpCoordinates} />
              <p className="op-guide-caption">示例使用 OkHttp 4.12.0。调用前请先获取有效 Token。</p>
            </section>
            <section id="sdk-java" tabIndex={-1} className="op-guide-section">
              <h2>2. 运行完整 Java 示例</h2>
              <p>保存为 ApiExample.java，通过运行配置提供 OPEN_PLATFORM_TOKEN。{gatewayBaseUrl ? '网关地址已自动填入；切换环境时重新复制目标环境示例。' : '另需配置 OPEN_PLATFORM_BASE_URL。'}下面是订单示例，实际接入请复制对应 API 文档中的 Java 请求示例。</p>
              <CodeBlock title="ApiExample.java · JDK 8+ / OkHttp" samples={[{ label: 'Java', language: 'java', code: examples.javaExample }]} maxHeight={480} />
              <CodeBlock title="在已有 Maven 项目目录中编译运行" samples={[{ label: 'Shell', language: 'bash', code: runCommands('ApiExample') }]} />
              <p className="op-guide-caption">Windows classpath 分隔符使用分号；运行前配置网关地址与业务 Token。</p>
            </section>
            <section id="sdk-tools" tabIndex={-1} className="op-guide-section">
              <h2>3. 使用 cURL 或 Postman 联调</h2>
              <p>不使用 SDK 也可完成接入。cURL 示例适用于 POSIX Shell：{gatewayBaseUrl ? '网关地址已填入，' : '先在安全配置中设置网关地址，'}token-request.json 按{anchor('token', '换取 Token')}填写，再用返回的 accessToken 配置 OPEN_PLATFORM_TOKEN。</p>
              <CodeBlock title="cURL" samples={[examples.tokenSamples.find((sample) => sample.label === 'cURL')!, examples.invokeSamples[0]].map((sample, index) => ({ ...sample, label: index ? '调用业务接口' : '获取 Token' }))} />
              <p>Postman 中选择 POST，填写实际网关路径；Body 选择 raw / JSON。获取 Token 时按签发接口提交凭据；调用业务时 Authorization 选择 Bearer Token，正文只放业务参数。不要把真实凭据同步到公开工作区。</p>
            </section>
            <section id="sdk-client" tabIndex={-1} className="op-guide-section">
              <h2>客户端使用建议</h2>
              <Table head={['事项', 'OkHttp 接入约定']} rows={[
                ['连接复用', '服务中复用一个 OkHttpClient；每次响应使用 try-with-resources 关闭。示例的资源释放用于独立程序结束，服务运行中不要每次关闭连接池。'],
                ['Token 更新', '复用有效 Token，更新后写入后续请求的 Authorization；不必为换 Token 重建 HTTP 客户端。'],
                ['响应处理', '核对 HTTP 状态，并按公共响应格式检查 code 和 data；勿把 HTTP 200 自动等同于业务成功。'],
                ['超时与重试', '示例连接 3 秒、完整调用 10 秒，关闭自动重试及重定向；超时后先确认业务结果。'],
              ]} />
            </section>
            <section id="sdk-platform" tabIndex={-1} className="op-guide-section">
              <h2>平台 SDK（可选）</h2>
              <p>已有平台客户端的项目可继续使用；需要平台 HMAC 签名封装时可选择此方式。普通 Token 调用优先使用上面的 OkHttp 示例。</p>
              <p>在 <a href="?section=sdk">Java SDK 中心</a>选择明确版本，核对运行环境、发布说明及 SHA-256，解压后按 README 构建。这里的 OpenPlatformClient 来自平台包，不包含在 OkHttp 依赖中。</p>
              <CodeBlock title="平台 SDK 签名模式" samples={[{ label: 'Java', language: 'java', code: `OpenPlatformClient.signed(
    URI.create(${gatewayBaseUrl ? JSON.stringify(gatewayBaseUrl) : 'System.getenv("OPEN_PLATFORM_BASE_URL")'}),
    System.getenv("OPEN_PLATFORM_KEY_ID"),
    System.getenv("OPEN_PLATFORM_SIGNING_SECRET"),
    System.getenv("OPEN_PLATFORM_TENANT_ID"),
    System.getenv("OPEN_PLATFORM_EMPLOYEE_NO")
)` }]} />
              <p className="op-guide-caption">SDK 的 invoke 方法使用服务、外部版本、操作和业务 JSON；不另带 Token。员工号可省略。keyId 为 32 位小写十六进制，SigningSecret 为 43 字符 Base64URL（解码 32 字节）；SDK 处理秒级时间戳和新 nonce。实际签名路径和正文不能被代理改写。</p>
            </section>
            <section id="guide-updates" tabIndex={-1} className="op-guide-section">
              <h2>版本与更新记录</h2>
              <p>已发布 SDK 的变化、运行环境和认证能力以对应版本说明及包内 README 为准。API 的维护、退役和迁移说明在各自文档中查看。</p>
              <div className="op-guide-links"><a className="op-guide-action" href="?section=sdk">查看 SDK 版本与发布说明</a><a href="?section=documents">查看 API 版本与维护说明 →</a></div>
            </section>
          </>}
        </div>
      </article>
      <aside className="op-guide-chapters">
        <nav aria-label="本章目录">
          <p className="op-guide-chapters__title">本章目录</p>
          {topic.sections.map(([id, title]) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} onClick={(event) => navigate(event, id)}>{title}</a>)}
        </nav>
      </aside>
    </div>
  );
}
