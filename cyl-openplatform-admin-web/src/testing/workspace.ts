/** 管理工作区HTTP测试响应；默认尚未发布。 */
export function workspaceSnapshot<T extends { id: string; draftRevision: number }>(definition: T) {
  return { definition, publication: { apiId: definition.id, stateVersion: 0, enabled: true, liveReleaseId: null, pendingReleaseId: null }, liveDraftRevision: null, pendingDraftRevision: null };
}
