package io.github.chenyilei2016.openplatform.application.publication;

/** 发布动作读取当前审核策略，保证提交与审批语义一致。 */
public interface PublishSettings {
    boolean auditEnabled();
}
