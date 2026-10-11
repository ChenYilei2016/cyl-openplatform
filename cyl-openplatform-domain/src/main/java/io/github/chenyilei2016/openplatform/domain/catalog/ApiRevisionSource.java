package io.github.chenyilei2016.openplatform.domain.catalog;

/** 历史来源与用户可读摘要；未知旧作者不会被操作人替代。 */
public enum ApiRevisionSource {
    CREATE_API_DRAFT("创建草稿"),
    UPDATE_API_DRAFT("编辑保存"),
    IMPORT_CREATE_API_DRAFT("批量导入新草稿"),
    IMPORT_UPDATE_API_DRAFT("批量导入更新"),
    ENVIRONMENT_RECEIVE_DRAFT("接收其他环境配置"),
    COPY_API_DRAFT("复制创建草稿"),
    RESTORE_API_DRAFT("恢复历史草稿"),
    HISTORY_BASELINE("历史起点：归档现有草稿，更早的草稿记录可能缺失"),
    LEGACY_RELEASE("历史起点：从已生效发布归档，更早的草稿记录可能缺失");

    private final String summary;

    ApiRevisionSource(String summary) { this.summary = summary; }
    public String summary() { return summary; }
}
