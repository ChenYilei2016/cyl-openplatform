import { Alert, Button, Drawer, Input, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import type { ApiDraft } from "./useApiDraft";

/**
 * “以 JSON 编辑整份配置”（111）：服务端严格解析后拆回各分区，不舍入大数；应用后仍需保存。
 * 已有 API 与尚未创建的草稿（复制、导入候选）共用；返回打开动作与抽屉节点。
 */
export function useWholeJsonEditor(draft: ApiDraft) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const cancelRequest = () => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
  };
  const close = () => {
    cancelRequest();
    setText(null);
  };
  useEffect(() => () => request.current?.abort(), []);
  const open = () => {
    // 有未应用的局部输入（如固定值 JSON）时先处理，避免整份 JSON 静默丢弃它。
    if (draft.manualBindingPending || draft.unappliedEdits || draft.candidate || draft.bindingCandidate) {
      draft.setError("请先处理未应用的手工签名、JSON 字段生成或公开示例，再以 JSON 编辑整份配置。");
      return;
    }
    if (!draft.requireAppliedEdits()) return;
    setError("");
    setText(draft.wholeJson());
  };
  const apply = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const applied = await draft.applyWholeJson(text ?? "", controller.signal);
      if (applied && !controller.signal.aborted) setText(null);
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  const drawer = (
    <Drawer
      open={text !== null}
      title="以 JSON 编辑整份配置"
      size={760}
      destroyOnHidden
      onClose={close}
      footer={
        <Space>
          <Button onClick={close}>取消</Button>
          <Button type="primary" loading={busy} onClick={() => void apply()}>
            校验并应用到页面
          </Button>
        </Space>
      }
    >
      <p className="op-muted">
        服务端严格解析后拆回各分区，不会舍入大数或高精度小数；应用后仍需{draft.creation ? (draft.creation.kind === "copy" ? "保存才会创建" : "确认候选") : "保存为修订"}。
        {draft.creation ? "" : "service、method、外部版本不可修改。"}
      </p>
      {error && <Alert type="error" showIcon title={error} className="op-config__banner" />}
      <Input.TextArea
        aria-label="整份配置 JSON"
        value={text ?? ""}
        onChange={(event) => {
          cancelRequest();
          setText(event.target.value);
        }}
        autoSize={{ minRows: 24 }}
        spellCheck={false}
        className="op-json-editor"
      />
    </Drawer>
  );
  return { open, drawer };
}
