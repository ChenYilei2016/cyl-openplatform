import { stringifyJson } from "@cyl/open-platform-web-shared/json";
import { StickyActionBar } from "@cyl/open-platform-web-shared/ui/components";
import { Alert, Button, ConfigProvider, Modal } from "antd";
import { useEffect, useRef, useState } from "react";
import { useAdminNavigation } from "../../navigation/AdminNavigation";
import type { ApiWorkspace } from "../CatalogPanel";
import ResponseExampleEditor from "../ResponseExampleEditor";
import BasicSection from "./BasicSection";
import CheckPanel from "./CheckPanel";
import ConflictDrawer from "./ConflictDrawer";
import DocSection from "./DocSection";
import McpSection from "./McpSection";
import { legacyStepSection, sectionOf, sections, stringify, type SectionKey } from "./draftModel";
import RequestSection from "./RequestSection";
import ResponseSection from "./ResponseSection";
import TargetSection from "./TargetSection";
import type { ApiDraft } from "./useApiDraft";

const time = (value: number) => new Date(value).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });

/** 配置页：左侧目录、中间单页分区、右侧检查面板、底部保存栏（111）。 */
export default function ConfigPage({ draft, workspace, canManageConnections, active }: { draft: ApiDraft; workspace: ApiWorkspace | null; canManageConnections: boolean; active: boolean }) {
  const navigation = useAdminNavigation();
  const route = navigation.route;
  const mcpOnly = !draft.creation && route.step === "mcp";
  const visibleSections = sections.filter(section => draft.creation || (mcpOnly ? section.key === "mcp" : section.key !== "mcp"));
  const [current, setCurrent] = useState<SectionKey>("basic");
  const body = useRef<HTMLFieldSetElement>(null);
  const scrollTo = (key: SectionKey) => {
    setCurrent(key);
    document.getElementById(`config-${key}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  // 旧地址的“对内配置 / 返回与文档”步骤：定位到单页分区，再规范为配置页地址。
  useEffect(() => {
    const section = legacyStepSection[route.step];
    if (!section) return;
    navigation.navigate({ ...route, step: "outer" }, true);
    requestAnimationFrame(() => scrollTo(section));
  }, [route.step]);

  // 滚动时高亮当前分区（不支持 IntersectionObserver 的环境保持点击高亮）。
  useEffect(() => {
    if (!active || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrent((visible.target as HTMLElement).dataset.section as SectionKey);
      },
      { rootMargin: "-96px 0px -60% 0px" },
    );
    body.current?.querySelectorAll("[data-section]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [active, mcpOnly]);

  // ⌘S / Ctrl+S 保存为修订。
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!draft.busy && !draft.locked) void draft.save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, draft]);

  const errorCount = (key: SectionKey) => draft.issues.filter((issue) => sectionOf(issue.path) === key).length;
  // 修订号可能超出安全整数（无损 JSON 数值），用 BigInt 计算下一修订。
  const nextRevision = (() => {
    try {
      return `r${(BigInt(stringifyJson(draft.definition.draftRevision)) + 1n).toString()}`;
    } catch {
      return "";
    }
  })();
  const creation = draft.creation?.kind;
  const status = draft.unappliedEdits
    ? "字段编辑或 JSON 生成尚未应用，请先应用或取消。"
    : creation === "candidate"
      ? "候选配置，尚未写入草稿；确认后回到导入批次统一核对"
      : creation === "copy"
        ? "尚未创建；保存后生成新 API 的草稿，不会发布"
        : draft.dirty
          ? `${draft.stashedAt ? `已暂存 ${time(draft.stashedAt)} · ` : ""}${draft.changed.length} 处改动未保存为修订`
          : draft.saveMessage || `已保存 r${stringifyJson(draft.definition.draftRevision)}，保存不会发布`;
  const primaryLabel = creation === "candidate" ? "确认候选" : creation === "copy" ? "保存并创建 API" : `保存为修订 ${nextRevision}`;
  const disabled = draft.busy || draft.testing || draft.locked;
  return (
    <div className="op-config" hidden={!active}>
      {draft.stashOffer && (
        <Alert
          className="op-config__banner"
          type="warning"
          showIcon
          title={`发现 ${time(draft.stashOffer.savedAt)} 暂存在本页的未保存修改`}
          description="可能来自误关的页面。恢复后仍需保存为修订。"
          action={
            <div className="op-config__banner-actions">
              <Button size="small" type="primary" onClick={draft.restoreStash}>
                恢复未保存修改
              </Button>
              <Button size="small" onClick={draft.discardStash}>
                丢弃
              </Button>
            </div>
          }
        />
      )}
      {draft.error && <Alert className="op-config__banner" type="error" showIcon title={draft.error} closable onClose={() => draft.setError("")} />}
      <div className={`op-config__layout${mcpOnly ? " op-config__layout--mcp" : ""}`}>
        <nav className="op-config__toc" aria-label="配置目录" hidden={mcpOnly}>
          <ul>
            {visibleSections.map(({ key, title }) => {
              const modified = draft.changedSections.has(key);
              const errors = errorCount(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`op-config__toc-item${current === key ? " is-active" : ""}`}
                    aria-current={current === key ? "location" : undefined}
                    aria-label={`${title}${modified ? "，有未保存修改" : ""}${errors ? `，${errors}处错误` : ""}`}
                    onClick={() => scrollTo(key)}
                  >
                    <span>{title}</span>
                    {modified && <span className="op-config__dot" aria-hidden />}
                    {errors > 0 && (
                      <span className="op-config__count" aria-hidden>
                        {errors}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <ConfigProvider componentDisabled={disabled}>
          <form
            ref={draft.formRef}
            noValidate
            className="op-config__body"
            aria-label="API 配置"
            onChangeCapture={(event) => {
              if (!(event.target as HTMLElement).closest("[data-preview-input]")) draft.bumpInput();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void draft.save();
            }}
          >
            <fieldset ref={body} className="op-config__fieldset" disabled={disabled}>
              <div className="op-config__fieldset" hidden={mcpOnly}>
                <BasicSection draft={draft} />
                <RequestSection draft={draft} />
                <TargetSection draft={draft} canManageConnections={canManageConnections} />
                <ResponseSection draft={draft} />
                <DocSection draft={draft} />
              </div>
              <div hidden={!mcpOnly && !draft.creation}><McpSection draft={draft} /></div>
            </fieldset>
          </form>
        </ConfigProvider>
        <CheckPanel draft={draft} workspace={workspace} onVersions={() => navigation.navigate({ ...route, step: "history", releaseId: null })} />
      </div>
      <StickyActionBar status={<span className={draft.dirty || creation ? "op-config__status is-dirty" : "op-config__status"}>{status}</span>}>
        <Button onClick={() => void draft.validate()} loading={draft.checking} disabled={disabled || draft.manualBindingPending}>
          校验
        </Button>
        <Button type="primary" onClick={() => void draft.save()} loading={draft.busy && !draft.locked} disabled={draft.testing || draft.locked} aria-keyshortcuts="Meta+S Control+S">
          {primaryLabel}
        </Button>
      </StickyActionBar>
      <Modal
        open={draft.bindingCandidate !== null}
        title="确认替换内部绑定"
        okText="确认替换并检查映射"
        cancelText="取消"
        onOk={draft.confirmBinding}
        onCancel={draft.cancelBinding}
        width={760}
      >
        <p>外部契约保持不变。现有 {draft.lastMappings.length} 条参数映射会保留，请核对目标方法、内部版本和分组、argN 顺序及来源。</p>
        <div className="op-config__compare">
          <div>
            <strong>已确认绑定</strong>
            <pre className="op-config-example">{stringify(draft.confirmedBinding)}</pre>
          </div>
          <div>
            <strong>待应用绑定</strong>
            <pre className="op-config-example">{draft.bindingCandidate && stringify(draft.bindingCandidate)}</pre>
          </div>
        </div>
      </Modal>
      <Modal open={draft.candidate !== null} title="编辑公开响应示例" footer={null} width={880} onCancel={draft.closeExample} destroyOnHidden>
        {draft.candidate && (
          <div className="op-legacy-editor">
            <ResponseExampleEditor
              key={stringifyJson(draft.candidate)}
              api={draft.api}
              schema={draft.candidate.schema}
              schemaText={draft.sections.responseSchema}
              source={draft.candidate.source}
              onCancel={draft.closeExample}
              onApply={(schema) => {
                draft.change("responseSchema", stringify(schema));
                draft.closeExample();
              }}
            />
          </div>
        )}
      </Modal>
      <ConflictDrawer draft={draft} />
    </div>
  );
}
