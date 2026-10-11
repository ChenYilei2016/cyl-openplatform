package io.github.chenyilei2016.openplatform.domain.operations;

import io.github.chenyilei2016.openplatform.domain.observability.CallIdentityKind;

/** 有界排行投影；人员归属由租户+员工ID决定，名称只是展示。 */
public record StatisticsRank(String tenantId, String employeeId, CallIdentityKind identityKind, String apiId,
                             String name, String employeeNo, String tenantName, OperationsTotals totals) {}
