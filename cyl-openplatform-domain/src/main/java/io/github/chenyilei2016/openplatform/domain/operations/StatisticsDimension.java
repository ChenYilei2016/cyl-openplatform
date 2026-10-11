package io.github.chenyilei2016.openplatform.domain.operations;

/** 人员始终按租户和员工ID分组，不能用姓名或全局工号定位。 */
public enum StatisticsDimension { TENANT, PERSON, API }
