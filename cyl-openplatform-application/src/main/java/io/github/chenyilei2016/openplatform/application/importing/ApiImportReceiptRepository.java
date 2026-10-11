package io.github.chenyilei2016.openplatform.application.importing;

import io.github.chenyilei2016.openplatform.domain.access.AccessOperator;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.Optional;

/** 成功导入回执与草稿在同一事务写入，不持久化上传原文。 */
public interface ApiImportReceiptRepository {
    enum SourceKind {
        PLATFORM("平台接口配置 JSON"), OPENAPI("OpenAPI 3.0 JSON 接口文档"), HTTP("HTTP 请求文本");
        private final String label;
        SourceKind(String label) { this.label = label; }
        public String label() { return label; }
        public static SourceKind parse(String value) {
            try { return valueOf(value); }
            catch (IllegalArgumentException | NullPointerException failure) {
                throw new PlatformException(ErrorCode.INVALID_REQUEST, "导入来源种类无效");
            }
        }
    }
    record Receipt(String contentDigest, ImportModels.Confirmation result) {}
    record SourceInfo(String apiId, long revision, String sourceKind, String sourceLabel, String sourceDigest) {}
    Receipt reserve(AccessOperator operator, String submissionKey, String contentDigest, String sourceKind, String sourceDigest);
    void complete(AccessOperator operator, String submissionKey, ImportModels.Confirmation result);
    Optional<Receipt> find(AccessOperator operator, String submissionKey);
    Optional<SourceInfo> provenance(String apiId, long revision);
}
