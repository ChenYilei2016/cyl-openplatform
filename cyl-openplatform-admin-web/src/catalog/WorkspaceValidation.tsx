import { AdminApiError } from "../access/api";

export interface FieldIssue {
  path: string;
  reason: string;
  message: string;
}
export interface CandidateValidation {
  valid: boolean;
  fieldIssues: FieldIssue[];
  truncated: boolean;
  checkedDraftRevision: number | null;
}
export function failureIssues(failure: unknown): FieldIssue[] {
  if (
    !(failure instanceof AdminApiError) ||
    !failure.data ||
    typeof failure.data !== "object"
  )
    return [];
  const items = (failure.data as { fieldIssues?: unknown }).fieldIssues;
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (item): item is FieldIssue =>
        item &&
        typeof item.path === "string" &&
        typeof item.reason === "string" &&
        typeof item.message === "string",
    )
    .slice(0, 50);
}
