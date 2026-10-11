package io.github.chenyilei2016.openplatform.application.operations;

/** 运营数据保留及告警评估配置；入口层调度与应用服务共用，绑定由基础设施实现。 */
public interface OperationsSettings {
    int getRetentionDays();
    boolean isEvaluationEnabled();
}
