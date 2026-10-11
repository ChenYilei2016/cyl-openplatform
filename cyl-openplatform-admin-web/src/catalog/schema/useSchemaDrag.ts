import { useState, type DragEvent } from "react";
import { pathKey, type SchemaPath, type SchemaRow } from "./schemaTree";

/** 同级拖动排序：只接受同一父对象下的字段，落点按目标行上半 / 下半决定前后。 */
export function useSchemaDrag(onMove: (path: SchemaPath, target: string, after: boolean) => void) {
  const [dragging, setDragging] = useState<SchemaPath | null>(null);
  const [hint, setHint] = useState<{ key: string; after: boolean } | null>(null);
  const sameParent = (row: SchemaRow) =>
    dragging !== null && row.path.at(-1) !== "[]" && pathKey(row.path.slice(0, -1)) === pathKey(dragging.slice(0, -1)) && pathKey(row.path) !== pathKey(dragging);
  const after = (event: DragEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2;
  };
  const reset = () => {
    setDragging(null);
    setHint(null);
  };
  return {
    handleProps: (row: SchemaRow) => ({
      draggable: row.path.at(-1) !== "[]",
      onDragStart: (event: DragEvent<HTMLSpanElement>) => {
        event.dataTransfer?.setData("text/plain", row.key);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        const tr = event.currentTarget.closest("tr");
        if (tr) event.dataTransfer?.setDragImage?.(tr, 16, 16);
        setDragging(row.path);
      },
      onDragEnd: reset,
    }),
    rowProps: (row: SchemaRow) => ({
      onDragOver: (event: DragEvent<HTMLTableRowElement>) => {
        if (!sameParent(row)) return;
        event.preventDefault();
        const next = { key: row.key, after: after(event) };
        if (hint?.key !== next.key || hint.after !== next.after) setHint(next);
      },
      onDragLeave: () => hint?.key === row.key && setHint(null),
      onDrop: (event: DragEvent<HTMLTableRowElement>) => {
        if (!sameParent(row) || !dragging) return;
        event.preventDefault();
        onMove(dragging, row.path.at(-1)!, after(event));
        reset();
      },
    }),
    rowClass: (row: SchemaRow) =>
      [dragging && pathKey(dragging) === row.key && "is-dragging", hint?.key === row.key && (hint.after ? "is-drop-after" : "is-drop-before")].filter(Boolean).join(" ") || undefined,
  };
}
