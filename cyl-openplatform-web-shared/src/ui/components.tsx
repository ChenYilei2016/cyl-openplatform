import {
  CheckOutlined,
  CopyOutlined,
  EllipsisOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  LockOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Dropdown, Input, Modal, Popconfirm, Tabs, Tooltip, type MenuProps, type TabsProps } from "antd";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* ---------------------------------- 页头 ---------------------------------- */

export interface PageHeaderProps {
  title: ReactNode;
  count?: number;
  breadcrumb?: ReactNode;
  meta?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  /** 低频动作收进“更多”；为空时不显示。 */
  moreActions?: MenuProps["items"];
  onMoreAction?: (key: string) => void;
}

export function PageHeader({ title, count, breadcrumb, meta, primaryAction, secondaryActions, moreActions, onMoreAction }: PageHeaderProps) {
  return (
    <header className="op-page-header">
      <div className="op-page-header__main">
        {breadcrumb && <div className="op-page-header__breadcrumb">{breadcrumb}</div>}
        <h1 className="op-page-header__title">
          {title}
          {count !== undefined && <span className="op-page-header__count" aria-label={`共 ${count} 项`}>{count}</span>}
        </h1>
        {meta && <div className="op-page-header__meta">{meta}</div>}
      </div>
      {(primaryAction || secondaryActions || moreActions?.length) && (
        <div className="op-page-header__actions">
          {secondaryActions}
          {moreActions?.length ? (
            <Dropdown menu={{ items: moreActions, onClick: ({ key }) => onMoreAction?.(key) }} trigger={["click"]}>
              <Button icon={<EllipsisOutlined />} aria-label="更多操作" />
            </Dropdown>
          ) : null}
          {primaryAction}
        </div>
      )}
    </header>
  );
}

/* --------------------------------- 状态 ---------------------------------- */

export type StatusTone = "success" | "warning" | "error" | "info" | "neutral" | "processing";
export interface StatusDefinition {
  tone: StatusTone;
  label: string;
}

/** pulse 只用于真正正在进行的过程（如执行中、同步中），等待人工处理不闪烁。 */
export function StatusBadge({ tone, children, detail, title, pulse = false }: { tone: StatusTone; children: ReactNode; detail?: ReactNode; title?: string; pulse?: boolean }) {
  return (
    <span className={`op-status op-status--${tone}${pulse ? " op-status--pulse" : ""}`} title={title}>
      <span className="op-status__dot" aria-hidden />
      <span>{children}</span>
      {detail && <span className="op-status__detail">{detail}</span>}
    </span>
  );
}

/** 业务枚举 → 状态外观的集中映射；未登记的值以中性样式原样显示，便于发现遗漏。 */
export function defineStatusMap<T extends string>(map: Record<T, StatusDefinition>) {
  return {
    map,
    get(value: T | string | null | undefined): StatusDefinition {
      return (value && (map as Record<string, StatusDefinition>)[value]) || { tone: "neutral", label: value || "未知" };
    },
    Badge({ value, detail }: { value: T | string | null | undefined; detail?: ReactNode }) {
      const definition = (value && (map as Record<string, StatusDefinition>)[value]) || { tone: "neutral" as const, label: value || "未知" };
      return <StatusBadge tone={definition.tone} detail={detail}>{definition.label}</StatusBadge>;
    },
  };
}

/* ------------------------------- 技术编号 -------------------------------- */

export function middleEllipsis(value: string, maxChars: number) {
  if (value.length <= maxChars || maxChars < 5) return value;
  const head = Math.ceil((maxChars - 1) / 2);
  const tail = Math.floor((maxChars - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Tooltip title={copied ? "已复制" : `复制${label}`}>
      <button
        type="button"
        className="op-id__copy"
        data-copied={copied}
        aria-label={copied ? `已复制${label}` : `复制${label}`}
        onClick={async (event) => {
          event.stopPropagation();
          await writeClipboard(value);
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <CheckOutlined /> : <CopyOutlined />}
      </button>
    </Tooltip>
  );
}

/** AK、requestId、服务标识等：等宽、中间省略、悬停看全文、可复制。 */
export function IdText({ value, label = "", copyable = true, maxChars = 24, style }: { value: string; label?: string; copyable?: boolean; maxChars?: number; style?: CSSProperties }) {
  const shown = middleEllipsis(value, maxChars);
  const text = <span className="op-id__text">{shown}</span>;
  return (
    <span className="op-id" style={style}>
      {shown === value ? text : <Tooltip title={<span className="op-code">{value}</span>}>{text}</Tooltip>}
      {copyable && <CopyButton value={value} label={label || value} />}
    </span>
  );
}

/** Java 内部类：显示简名（可带方法），悬停与复制使用全限定名。 */
export function ClassRef({ className, method, copyable = true }: { className: string; method?: string | null; copyable?: boolean }) {
  const simple = className.split(".").pop() || className;
  const full = method ? `${className}#${method}` : className;
  const shown = method ? `${simple}#${method}` : simple;
  return (
    <span className="op-id">
      <Tooltip title={<span className="op-code">{full}</span>}>
        <span className="op-id__text">{shown}</span>
      </Tooltip>
      {copyable && <CopyButton value={full} label="全限定名" />}
    </span>
  );
}

/* ------------------------------- 人与租户 -------------------------------- */

/** stacked：表格中姓名一行、工号与租户一行，避免窄列内逐字折行。 */
export function PersonTag({ name, employeeNo, tenantName, id, stacked = false }: { name?: string | null; employeeNo?: string | null; tenantName?: string | null; id?: string | null; stacked?: boolean }) {
  if (!name) {
    const hint = [employeeNo && `工号 ${employeeNo}`, id && `ID ${id}`].filter(Boolean).join(" · ");
    return (
      <Tooltip title={hint || undefined}>
        <span className="op-person op-person--missing">{employeeNo ? `工号 ${employeeNo}` : "未登记"}</span>
      </Tooltip>
    );
  }
  const sub = [employeeNo && `工号 ${employeeNo}`, tenantName].filter(Boolean).join(" · ");
  const content = (
    <span className={`op-person${stacked ? " op-person--stacked" : ""}`}>
      <span>{name}</span>
      {sub && <span className="op-person__sub">{sub}</span>}
    </span>
  );
  return id ? <Tooltip title={<span className="op-code">{id}</span>}>{content}</Tooltip> : content;
}

export function TenantTag({ name, id }: { name?: string | null; id: string }) {
  if (!name) return <IdText value={id} label="租户 ID" maxChars={20} />;
  return (
    <Tooltip title={<span className="op-code">{id}</span>}>
      <span className="op-person">{name}</span>
    </Tooltip>
  );
}

/* --------------------------------- 抽屉 ---------------------------------- */

export interface EntityDrawerProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  width?: "md" | "lg";
  tabs?: TabsProps["items"];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
}

const drawerWidth = { md: 640, lg: 880 } as const;

/** 全站唯一详情形态：右侧抽屉，Esc 关闭，关闭后焦点回到打开前的位置。 */
export function EntityDrawer({ open, title, subtitle, status, actions, width = "md", tabs, activeTab, onTabChange, onClose, children, footer, loading }: EntityDrawerProps) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    if (document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement;
    // 条件渲染直接卸载时不会触发Drawer的关闭动画回调。
    return () => { if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, [open]);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={drawerWidth[width]}
      className="op-drawer"
      destroyOnHidden
      loading={loading}
      keyboard
      aria-labelledby={titleId}
      afterOpenChange={(visible) => {
        if (!visible) returnFocus.current?.focus?.();
      }}
      title={
        <div>
          <div className="op-drawer__title">
            <h2 id={titleId}>{title}</h2>
            {status}
          </div>
          {subtitle && <div className="op-drawer__subtitle">{subtitle}</div>}
        </div>
      }
      extra={actions}
      footer={footer}
    >
      {tabs ? <Tabs className="op-drawer__tabs" items={tabs} activeKey={activeTab} onChange={onTabChange} /> : children}
    </Drawer>
  );
}

/* ------------------------------- 禁用原因 -------------------------------- */

/**
 * 不可用的按钮悬停或聚焦时说明原因（权限不足、环境限制等）。禁用按钮不触发鼠标事件，
 * 因此由外层可聚焦的包裹元素承载提示。
 */
export function DisabledReason({ reason, children }: { reason?: ReactNode; children: ReactNode }) {
  // 有无原因都保持同一层级，按钮在可用/不可用间切换时不会被重新挂载。
  return (
    <Tooltip title={reason || undefined} trigger={["hover", "focus"]}>
      <span className="op-disabled-reason" tabIndex={reason ? 0 : undefined} aria-label={reason && typeof reason === "string" ? `不可用：${reason}` : undefined}>
        {children}
      </span>
    </Tooltip>
  );
}

/* --------------------------------- 表单 ---------------------------------- */

export function FormSection({ title, description, columns = 2, id, children, stacked = false }: { title: ReactNode; description?: ReactNode; columns?: 1 | 2 | 3; id?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <section id={id} className={`op-form-section${stacked ? " op-form-section--stacked" : ""}`} aria-label={typeof title === "string" ? title : undefined}>
      <div className="op-form-section__head">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="op-form-section__body" style={{ "--op-form-columns": columns } as CSSProperties}>
        {children}
      </div>
    </section>
  );
}

/** 字段说明：悬停或键盘聚焦即显示，不需要点击。 */
export function FieldHelp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip title={children} trigger={["hover", "focus"]}>
      <button type="button" className="op-help" aria-label={`${label}说明`}>
        <QuestionCircleOutlined />
      </button>
    </Tooltip>
  );
}

export function FieldLabel({ label, help, required }: { label: string; help?: ReactNode; required?: boolean }) {
  return (
    <span className="op-field-label">
      {label}
      {required && <span aria-hidden className="op-required">*</span>}
      {help && <FieldHelp label={label}>{help}</FieldHelp>}
    </span>
  );
}

/** 只读信息：普通文字 + 锁图标，不再使用禁用输入框。 */
export function ReadonlyField({ label, value, reason, code = false, help }: { label: string; value: ReactNode; reason?: ReactNode; code?: boolean; help?: ReactNode }) {
  return (
    <div className="op-readonly" role="group" aria-label={label}>
      <FieldLabel label={label} help={help} />
      <div className={`op-readonly__value${code ? " op-readonly__value--code" : ""}`}>
        <span>{value}</span>
        {reason && (
          <Tooltip title={reason}>
            <LockOutlined className="op-readonly__lock" aria-label={`不可修改：${typeof reason === "string" ? reason : ""}`} />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- 确认 ---------------------------------- */

export interface ConfirmActionProps {
  title: string;
  description?: ReactNode;
  okText?: string;
  danger?: boolean;
  /** 需要填写原因时使用弹窗形态。 */
  reason?: { label: string; placeholder?: string; maxLength?: number };
  onConfirm: (reason?: string) => void | Promise<unknown>;
  children: ReactNode;
  disabled?: boolean;
}

export function ConfirmAction({ title, description, okText = "确认", danger = false, reason, onConfirm, children, disabled }: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (value?: string) => {
    setBusy(true);
    try {
      await onConfirm(value);
      setOpen(false);
      setText("");
    } finally {
      setBusy(false);
    }
  };
  if (!reason)
    return (
      <Popconfirm title={title} description={description} okText={okText} cancelText="取消" okButtonProps={{ danger, loading: busy }} onConfirm={() => run()} disabled={disabled}>
        {children}
      </Popconfirm>
    );
  return (
    <>
      <span onClickCapture={() => !disabled && setOpen(true)}>{children}</span>
      <Modal
        open={open}
        title={title}
        okText={okText}
        cancelText="取消"
        okButtonProps={{ danger, loading: busy, disabled: !text.trim() }}
        onOk={() => run(text.trim())}
        onCancel={() => { setOpen(false); setText(""); }}
        destroyOnHidden
      >
        {description && <div className="op-confirm__description">{description}</div>}
        <label>
          <FieldLabel label={reason.label} required />
          <Input.TextArea value={text} onChange={(event) => setText(event.target.value)} placeholder={reason.placeholder} maxLength={reason.maxLength ?? 500} autoSize={{ minRows: 3, maxRows: 6 }} aria-label={reason.label} autoFocus />
        </label>
      </Modal>
    </>
  );
}

/* --------------------------------- 空态 ---------------------------------- */

const emptyDefaults = {
  empty: { icon: <InboxOutlined />, title: "暂无数据" },
  noResult: { icon: <SearchOutlined />, title: "没有符合条件的结果" },
  forbidden: { icon: <StopOutlined />, title: "没有访问权限" },
  error: { icon: <ExclamationCircleOutlined />, title: "加载失败" },
} as const;

export function EmptyState({ kind = "empty", title, description, action }: { kind?: keyof typeof emptyDefaults; title?: ReactNode; description?: ReactNode; action?: ReactNode }) {
  const preset = emptyDefaults[kind];
  return (
    <div className={`op-empty op-empty--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="op-empty__icon" aria-hidden>{preset.icon}</span>
      <p className="op-empty__title">{title ?? preset.title}</p>
      {description && <p className="op-empty__description">{description}</p>}
      {action && <div className="op-empty__action">{action}</div>}
    </div>
  );
}

/* --------------------------------- 指标 ---------------------------------- */

/** 关键数字；emphasis 在门户中使用强调渐变。 */
export function Metric({ label, value, emphasis = false }: { label: ReactNode; value: ReactNode; emphasis?: boolean }) {
  return (
    <div className="op-metric">
      <span className={`op-metric__value${emphasis ? " op-gradient-text" : ""}`}>{value}</span>
      <span className="op-metric__label">{label}</span>
    </div>
  );
}

/* ------------------------------- 底部操作栏 ------------------------------ */

export function StickyActionBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div className="op-action-bar" role="region" aria-label="保存与操作">
      <div className="op-action-bar__status" aria-live="polite">{status}</div>
      <div className="op-action-bar__actions">{children}</div>
    </div>
  );
}
