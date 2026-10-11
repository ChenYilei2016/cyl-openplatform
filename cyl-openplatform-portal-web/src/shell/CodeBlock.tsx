import { CheckOutlined, CopyOutlined } from "@ant-design/icons";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-java";
import "prismjs/components/prism-python";
import "prismjs/components/prism-javascript";
import { useEffect, useMemo, useRef, useState } from "react";

// 只由本组件按需高亮。Prism 默认会在加载后自动重写页面上带 language-* 类的代码块（按 textContent 重排，丢失逐行结构与换行），
// 其回调在执行时才检查该开关，因此在模块求值时关闭即可生效。
Prism.manual = true;

/** 只打包这几种语言（115）：示例与调试代码只用到它们。 */
export type CodeLanguage = "bash" | "json" | "java" | "python" | "javascript" | "text";
export interface CodeSample {
  label: string;
  language: CodeLanguage;
  code: string;
}

const highlight = (code: string, language: CodeLanguage) => {
  const grammar = language === "text" ? undefined : Prism.languages[language];
  return grammar ? Prism.highlight(code, grammar, language) : code.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);
};

/**
 * 深色代码块：语法高亮、行号、语言页签与一键复制（复制后短暂显示“已复制”）。
 * 高亮在本地完成，只处理传入文本；行号用 CSS 计数，复制得到的是原始代码。
 */
export default function CodeBlock({ samples, title, maxHeight, className, initialLabel }: { samples: CodeSample[]; title?: string; maxHeight?: number; className?: string; /** 初始选中的页签（按 label），缺省为第一个。 */ initialLabel?: string }) {
  const [active, setActive] = useState(() => Math.max(0, samples.findIndex((item) => item.label === initialLabel)));
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (active >= samples.length) setActive(0);
  }, [samples.length, active]);
  const sample = samples[Math.min(active, samples.length - 1)];
  const lines = useMemo(() => (sample ? highlight(sample.code, sample.language).split("\n") : []), [sample?.code, sample?.language]);
  if (!sample) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sample.code);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用时用户仍可手动选择复制。 */
    }
  };
  return (
    <figure className={`op-code-block${className ? ` ${className}` : ""}`}>
      <figcaption className="op-code-block__bar">
        {title && <span className="op-code-block__title">{title}</span>}
        {samples.length > 1 ? (
          <span className="op-code-block__tabs" role="tablist" aria-label={`${title ?? "代码"}语言`}>
            {samples.map((item, index) => (
              <button key={item.label} type="button" role="tab" aria-selected={index === active} className="op-code-block__tab" onClick={() => setActive(index)}>
                {item.label}
              </button>
            ))}
          </span>
        ) : (
          !title && <span className="op-code-block__title">{sample.label}</span>
        )}
        <button type="button" className={`op-code-block__copy${copied ? " is-copied" : ""}`} onClick={() => void copy()} aria-label={copied ? "已复制" : `复制${sample.label}代码`}>
          {copied ? <CheckOutlined aria-hidden /> : <CopyOutlined aria-hidden />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </figcaption>
      <pre className={`op-code-block__pre language-${sample.language}`} style={maxHeight ? { maxHeight } : undefined} tabIndex={0}>
        <code>
          {lines.map((line, index) => (
            // 每行一个元素，CSS 计数生成行号；高亮结果来自 Prism 对传入文本的转义输出。
            <span key={index} className="op-code-block__line" dangerouslySetInnerHTML={{ __html: line || " " }} />
          ))}
        </code>
      </pre>
    </figure>
  );
}
