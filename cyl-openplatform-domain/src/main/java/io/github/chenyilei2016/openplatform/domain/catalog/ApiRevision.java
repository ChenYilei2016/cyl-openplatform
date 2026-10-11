package io.github.chenyilei2016.openplatform.domain.catalog;

/** 不可变历史正文，仅按API及修订号点读。 */
public record ApiRevision(ApiRevisionSummary metadata, ApiDefinition snapshot) {}
