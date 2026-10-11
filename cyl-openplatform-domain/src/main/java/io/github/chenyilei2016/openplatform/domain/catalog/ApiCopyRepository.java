package io.github.chenyilei2016.openplatform.domain.catalog;

import java.util.Optional;

/** 复制命令按可信租户、人员与创建键隔离；占位和创建结果随业务事务一起提交。 */
public interface ApiCopyRepository {
    record Receipt(String contentDigest, ApiDefinition result) {}
    Receipt reserve(String tenantId, String employeeNo, String creationKey, String contentDigest);
    void complete(String tenantId, String employeeNo, String creationKey, ApiDefinition result);
    Optional<Receipt> find(String tenantId, String employeeNo, String creationKey);
}
