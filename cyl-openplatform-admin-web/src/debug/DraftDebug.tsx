import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "antd";
import type { ApiDocument } from "@cyl/open-platform-web-shared/documentation/types";
import { parseJson, stringifyJson } from "@cyl/open-platform-web-shared/json";
import { StickyActionBar } from "@cyl/open-platform-web-shared/ui/components";
import { AdminApiError, type AdminApi } from "../access/api";
import type { ApiDefinition } from "../catalog/CatalogPanel";
import PublicationDiff from "../publication/PublicationDiff";
import IdentityPanel from "./IdentityPanel";
import { identityBody, rememberIdentity, rememberedIdentity, type IdentityChoice, type IdentityMode } from "./identity";
import { inputIssues, withoutSecrets } from "./RequestEditor";
import RequestCard from "./RequestCard";
import ResultPanel, { initialTab, type ResultTab } from "./ResultPanel";
import { useTokenIdentity } from "./useTokenIdentity";
import type { DebugDefinition, DebugEditorActions, DebugResult } from "./types";
import "./debug.css";

interface Props {
  initialInput?: string;
  onInputChange?: (input: string) => void;
  api: AdminApi;
  definition: DebugDefinition;
  editor?: DebugEditorActions;
  onUseExample?: (data: unknown) => void;
  isActive?: boolean;
}

/** 112 调试页：调用身份（选凭据 / 高级 Token）+ 左请求右结果 + 底部操作栏。只调试已保存修订。 */
export default function DraftDebug(props: Props) {
  return <Workspace key={props.definition.id} {...props} />;
}
function Workspace({ api, definition, editor, onUseExample, isActive = true, initialInput = "{}", onInputChange }: Props) {
  const [mode, setModeState] = useState<IdentityMode>(() => rememberedIdentity().mode);
  const [choice, setChoiceState] = useState<IdentityChoice | null>(() => rememberedIdentity().choice);
  const identityArea = useRef<HTMLDivElement>(null);
  const requestArea = useRef<HTMLElement>(null);
  const [checkConfiguration, setCheckConfiguration] = useState(false);
  const [input, setInput] = useState(initialInput);
  const [latest, setLatest] = useState<ApiDefinition | null>(null);
  const inputCallback = useRef(onInputChange);
  inputCallback.current = onInputChange;
  useEffect(() => inputCallback.current?.(input), [input]);
  const [invalidInput, setInvalidInput] = useState(false);
  const [incompleteInput, setIncompleteInput] = useState(false);
  const validateInput = useCallback((invalid: boolean, incomplete: boolean) => {
    setInvalidInput(invalid);
    setIncompleteInput(incomplete);
  }, []);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [resultKind, setResultKind] = useState<"preflight" | "execute">("execute");
  const [tab, setTab] = useState<ResultTab>("publicResponse");
  const [error, setError] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [candidate, setCandidate] = useState<string | null>(null);
  const running = useRef(false);
  const businessSubmitted = useRef(false);
  const sequence = useRef(0);
  const active = useRef<AbortController | null>(null);
  const exampleRequest = useRef<AbortController | null>(null);
  const example = useRef<{ revision: string; text: string } | null>(null);
  const liveInput = useRef(input);
  liveInput.current = input;
  const editSequence = useRef(0);
  const acceptedRevision = useRef(stringifyJson(definition.draftRevision));
  const ownSave = useRef(false);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const revision = stringifyJson(definition.draftRevision);

  const setMode = (next: IdentityMode) => {
    tokens.stopVerifying();
    tokens.setNotice("");
    setResult(null);
    setModeState(next);
    rememberIdentity(next, choice);
  };
  const setChoice = (next: IdentityChoice | null) => {
    setChoiceState(next);
    setResult(null);
    setError("");
    rememberIdentity(mode, next);
  };
  const finish = useCallback(() => {
    running.current = false;
    setBusy(false);
    editorRef.current?.setBusy(false);
  }, []);
  /** 清除业务 Token 身份与结果；普通参数保留但移除秘密字段，就地修复的临时返回样例一并销毁。 */
  const clearIdentity = useCallback(() => {
    active.current?.abort();
    exampleRequest.current?.abort();
    sequence.current++;
    resetTokens.current();
    setInput((current) => withoutSecrets(current));
    setResult(null);
    editorRef.current?.setResponseSample?.(undefined);
    setUnknown(false);
    setCandidate(null);
    setPreparing(false);
    finish();
  }, [finish]);
  const tokens = useTokenIdentity({
    onInvalid: (message) => {
      clearIdentity();
      tokens.setNotice(message ?? "");
    },
    onError: setError,
  });
  const resetTokens = useRef(tokens.reset);
  resetTokens.current = tokens.reset;
  useEffect(
    () => () => {
      sequence.current++;
      active.current?.abort();
      exampleRequest.current?.abort();
      editorRef.current?.setBusy(false);
    },
    [],
  );
  useEffect(() => {
    const leave = () => {
      clearIdentity();
      setInput("{}");
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [clearIdentity]);
  // 同一 API 的页签往返保留身份；离开页签时停止等待（已发出的业务可能仍在执行）。
  useEffect(() => {
    if (isActive) return;
    tokens.stopVerifying();
    tokens.setForm(false);
    if (running.current) {
      active.current?.abort();
      sequence.current++;
      finish();
      setUnknown(businessSubmitted.current);
      setError(businessSubmitted.current ? "已停止等待，业务请求可能仍在执行；不会自动重试。" : "已停止准备，业务尚未发送。");
    }
  }, [isActive, finish]);
  useEffect(() => {
    if (ownSave.current || revision === acceptedRevision.current) return;
    acceptedRevision.current = revision;
    const pending = running.current;
    active.current?.abort();
    sequence.current++;
    finish();
    setResult(null);
    editorRef.current?.setResponseSample?.(undefined);
    example.current = null;
    if (pending) {
      setUnknown(businessSubmitted.current);
      setError("草稿修订已变化，停止接收旧结果；已发出的业务可能仍在执行。");
    }
  }, [revision, finish]);
  useEffect(() => {
    exampleRequest.current?.abort();
    example.current = null;
    setPreparing(false);
    setCandidate(null);
  }, [revision]);

  const fillExample = async () => {
    if (running.current) return;
    const epoch = editSequence.current;
    exampleRequest.current?.abort();
    const controller = new AbortController();
    exampleRequest.current = controller;
    setPreparing(true);
    setError("");
    try {
      if (example.current?.revision !== revision) {
        const document = await api<ApiDocument>(`/apis/${encodeURIComponent(definition.id)}/preview`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (stringifyJson(document.draftRevision) !== revision) throw new Error("草稿已变化，请核对最新修订后再取示例。");
        if (!document.requestExample || typeof document.requestExample !== "object" || Array.isArray(document.requestExample))
          throw new Error("没有可用的请求对象示例");
        example.current = { revision, text: stringifyJson(document.requestExample, 2) };
      }
      if (controller.signal.aborted || epoch !== editSequence.current) return;
      if (liveInput.current.trim() !== "{}" && liveInput.current.trim()) setCandidate(example.current!.text);
      else setInput(example.current!.text);
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) setPreparing(false);
    }
  };
  const requiresEmployee = Boolean(
    definition.employeeRequired ||
      definition.mappings?.some((value) => {
        const mapping = value as { source?: string; path?: string };
        return mapping.source === "CONTEXT" && ["employeeNo", "employeeId", "userId"].includes(mapping.path ?? "");
      }),
  );
  const credential = mode === "credential";
  const { token, identity } = tokens;
  const missingIdentity = credential ? !choice : !token.trim();
  const employeeMissing = requiresEmployee && (credential ? !!choice && !choice.employee : !!identity && !identity.context.employeeNo);
  const dirty = editor?.dirty() ?? false;
  const blocked = preparing
    ? "正在读取请求示例，请待填入后再测试。"
    : !credential && tokens.form
      ? "先完成业务身份准备，或取消后使用已有Token。"
      : missingIdentity
        ? credential
          ? "先选择调用身份。"
          : "先提供业务Token；也可用AK与Secret就地获取。"
        : employeeMissing
          ? credential
            ? "此API要求指定调用员工，请在调用身份中选择人员。"
            : "此API要求已获委托的员工身份，请更换Token。"
          : invalidInput
            ? "请修正请求参数中的标记问题。"
            : "";

  const run = async (kind: "preflight" | "execute", savedOnly = false) => {
    if (running.current || preparing) return;
    setError("");
    setUnknown(false);
    setCheckConfiguration(false);
    let parsed: unknown;
    try {
      parsed = parseJson(input);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("调试请求必须是 JSON 对象");
      if (incompleteInput || (invalidInput && !savedOnly)) throw new Error("请先修正请求参数中的错误");
      if (missingIdentity) throw new Error(credential ? "请先选择调用身份" : "请提供业务访问 Token");
    } catch (failure) {
      setError((failure as Error).message);
      return;
    }
    running.current = true;
    businessSubmitted.current = false;
    setBusy(true);
    setResult(null);
    setResultKind(kind);
    const epoch = ++sequence.current;
    const fixedInput = input;
    const fixedToken = token.trim();
    const fixedChoice = choice;
    const controller = new AbortController();
    active.current = controller;
    let submitted = false;
    try {
      let selected = definition;
      if (editor?.dirty() && !savedOnly) {
        ownSave.current = true;
        const saved = await editor.save();
        if (epoch !== sequence.current) return;
        if (!saved) {
          const failure = editorRef.current?.saveError?.();
          setCheckConfiguration(!!failure && (!(failure instanceof AdminApiError) || failure.code === 40900001 || failure.code >= 50000000));
          setError(`草稿未保存成功，业务尚未发送；${failure?.message ?? "请修正已定位的字段问题后再测试。"}`);
          return;
        }
        selected = saved;
        acceptedRevision.current = stringifyJson(saved.draftRevision);
      }
      ownSave.current = false;
      const issues = inputIssues(selected.requestSchema, parsed);
      if (issues.length) throw new Error(issues.map((issue) => `${issue.path}：${issue.message}`).join("；"));
      editorRef.current?.setBusy(true);
      submitted = true;
      businessSubmitted.current = kind === "execute";
      const identityPart = credential && fixedChoice ? `,"identity":${identityBody(fixedChoice)}` : "";
      const value = await api<DebugResult>(`/apis/${encodeURIComponent(selected.id)}/debug${kind === "preflight" ? "/preflight" : ""}`, {
        method: "POST",
        ...(credential ? {} : { bearerToken: fixedToken }),
        signal: controller.signal,
        bodyText: `{"expectedRevision":${stringifyJson(selected.draftRevision)},"input":${fixedInput}${identityPart}}`,
      });
      if (epoch !== sequence.current || controller.signal.aborted) return;
      setResult(value);
      setTab(initialTab(value, kind));
      if (!credential && value.identity?.expiresAt) tokens.setIdentity({ accessToken: fixedToken, expiresAt: value.identity.expiresAt, context: value.identity });
    } catch (failure) {
      if (epoch !== sequence.current || controller.signal.aborted) return;
      if (!credential && failure instanceof AdminApiError && failure.code === 40100003) {
        clearIdentity();
        tokens.setNotice("业务 Token 已失效，请重新准备身份；后台会话仍有效。");
      } else if (failure instanceof AdminApiError && (failure.data as DebugResult)?.checks) {
        const failedResult = failure.data as DebugResult;
        setResult(failedResult);
        setTab(initialTab(failedResult, "execute"));
      } else if (
        submitted &&
        kind === "execute" &&
        (!(failure instanceof AdminApiError) || failure.code >= 50000000 || (failure.code >= 500 && failure.code < 600))
      )
        setUnknown(true);
      setCheckConfiguration(failure instanceof AdminApiError && failure.code === 40900001);
      setError((failure as Error).message);
    } finally {
      ownSave.current = false;
      if (epoch === sequence.current) finish();
    }
  };
  const cancel = () => {
    active.current?.abort();
    sequence.current++;
    finish();
    setResult(null);
    setUnknown(businessSubmitted.current);
    setError(
      businessSubmitted.current ? "已停止等待，业务请求可能仍在执行；不会自动重试。" : "已停止等待，未发送提供方业务；若正在保存，请核对草稿修订。",
    );
  };

  const placeholder = busy
    ? "正在处理本次请求…"
    : missingIdentity
      ? "选择调用身份后，填写请求并执行调试"
      : invalidInput
        ? "补齐左侧请求参数后即可调试"
        : "请求已就绪，可以执行调试";
  return (
    <section className="op-debug" aria-label="API 测试工作区">
      <div ref={identityArea}>
        <IdentityPanel
          api={api}
          apiId={definition.id}
          mode={mode}
          onMode={setMode}
          choice={choice}
          onChoice={setChoice}
          requiresEmployee={requiresEmployee}
          busy={busy}
          scopeCodes={definition.scopeCodes}
          onClear={() => {
            clearIdentity();
            tokens.setNotice("");
          }}
          tokenMode={{
            token,
            identity,
            verifying: tokens.verifying,
            form: tokens.form,
            notice: tokens.notice,
            onToken: (value) => {
              tokens.stopVerifying();
              editorRef.current?.setResponseSample?.(undefined);
              tokens.setToken(value);
              tokens.setIdentity(null);
              setResult(null);
              tokens.setNotice("");
              setError("");
              setCheckConfiguration(false);
            },
            onVerify: () => {
              if (running.current) return;
              setError("");
              setCheckConfiguration(false);
              void tokens.verify();
            },
            onForm: (open) => {
              tokens.stopVerifying();
              tokens.setNotice("");
              tokens.setForm(open);
            },
            onIssued: (issued) => {
              tokens.stopVerifying();
              editorRef.current?.setResponseSample?.(undefined);
              setResult(null);
              tokens.setToken(issued.accessToken);
              tokens.setIdentity(issued);
              tokens.setForm(false);
              tokens.setNotice("");
            },
          }}
        />
      </div>
      {error && (
        <p className="op-debug__notice is-error" role="alert">
          {error}
        </p>
      )}
      {unknown && (
        <p className="op-debug__notice is-warning" role="status">
          无法确认业务执行结果。请通过请求号或提供方记录核对后，再决定是否重试。
        </p>
      )}
      {checkConfiguration && editor && (
        <div className="op-debug__conflict">
          <Button
            disabled={busy}
            onClick={async () => {
              try {
                setLatest(await api<ApiDefinition>(`/apis/${encodeURIComponent(definition.id)}`));
              } catch (failure) {
                setError((failure as Error).message);
              }
            }}
          >
            核对服务端最新配置
          </Button>
          {latest && (
            <>
              <PublicationDiff
                before={definition as ApiDefinition}
                after={latest}
                beforeLabel={`加载基线 r${revision}`}
                afterLabel={`服务端 r${stringifyJson(latest.draftRevision)}`}
              />
              <p>当前输入仍保留；核对后可继续编辑，或明确放弃本地配置并加载最新版本。</p>
              <Button onClick={editor.reload}>放弃本地配置并重新加载…</Button>
            </>
          )}
        </div>
      )}
      {dirty && (
        <p className="op-debug__notice is-warning">配置有未保存修改。调试只针对已保存的修订：执行时会先保存为新修订，也可以只调试已保存的 r{revision}。</p>
      )}
      <div className="op-debug__grid">
        <RequestCard
          ref={requestArea}
          definition={definition}
          schema={editor?.requestSchema ?? definition.requestSchema}
          input={input}
          onInput={(value) => {
            editSequence.current++;
            setInput(value);
            setCandidate(null);
            setResult(null);
          }}
          onInvalid={validateInput}
          busy={busy}
          preparing={preparing}
          dirty={dirty}
          onFillExample={() => void fillExample()}
          candidate={candidate}
          onCandidate={(accept) => {
            if (accept && candidate !== null) {
              editSequence.current++;
              setInput(candidate);
            }
            setCandidate(null);
          }}
          onConfigureTarget={editor?.configureTarget}
        />
        <section className="op-debug__card op-debug-result" aria-label="返回结果">
          <header className="op-debug__card-head">
            <h3>结果</h3>
          </header>
          <ResultPanel
            result={result}
            kind={resultKind}
            tab={tab}
            onTab={setTab}
            placeholder={placeholder}
            onCheckIdentity={() => identityArea.current?.scrollIntoView?.({ block: "center" })}
            onCheckRequest={() => {
              requestArea.current?.scrollIntoView?.({ block: "center" });
              requestArea.current?.querySelector<HTMLElement>("input,textarea,select")?.focus({ preventScroll: true });
            }}
            onConfigureTarget={editor?.configureTarget}
            onRepair={
              editor?.repairResponse &&
              ((structure) =>
                editor.repairResponse!(
                  result?.providerResponse.available && !result.providerResponse.truncated ? stringifyJson(result.providerResponse.value, 2) : undefined,
                  structure,
                ))
            }
            onUseExample={onUseExample}
          />
        </section>
      </div>
      <StickyActionBar
        status={
          <span className="op-debug__status">
            <strong>{busy ? "正在处理，请等待或停止等待" : blocked || (dirty ? "当前配置有修改，执行将先保存" : `固定测试修订 r${revision}`)}</strong>
            <small>仅调试草稿，不自动发布</small>
          </span>
        }
      >
        {busy ? (
          <Button onClick={cancel}>停止等待</Button>
        ) : (
          <>
            {dirty && (
              <Button disabled={incompleteInput || (!credential && tokens.form) || missingIdentity || employeeMissing} onClick={() => void run("execute", true)}>
                仅调试已保存 r{revision}
              </Button>
            )}
            {editor && dirty && <Button onClick={() => void editor.save()}>保存草稿</Button>}
            <Button disabled={!!blocked} onClick={() => void run("preflight")}>
              {dirty ? "保存并预检" : "检查准备情况"}
            </Button>
            <Button type="primary" disabled={!!blocked} onClick={() => void run("execute")}>
              {dirty ? "保存并调试" : "执行调试"}
            </Button>
          </>
        )}
      </StickyActionBar>
    </section>
  );
}
