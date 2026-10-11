package io.github.chenyilei2016.openplatform.infrastructure.connection.runtime;

import org.apache.dubbo.common.URL;
import org.apache.dubbo.metadata.report.MetadataReport;
import org.apache.dubbo.metadata.report.support.AbstractMetadataReportFactory;

/** 独立协议名只供平台连接模型使用，不替换其他模块的Dubbo元数据实现。 */
public final class ConnectionMetadataReportFactory extends AbstractMetadataReportFactory {
    @Override
    public MetadataReport createMetadataReport(URL url) {
        return new ConnectionMetadataReport(url);
    }
}
