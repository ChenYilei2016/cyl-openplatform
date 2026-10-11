package io.github.chenyilei2016.openplatform.application.importing;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;

/** 导入保存的环境准入检查；不调用提供方，不改变普通手动草稿保存语义。 */
public interface HttpImportTargetPolicy {
    Decision check(ApiDefinition before, ApiDefinition candidate);

    enum Decision {
        PERMITTED(null, null),
        REJECTED("HTTP地址或绑定格式不合法，请使用无凭据及fragment的HTTP/HTTPS地址", null);

        private final String error;
        private final String warning;
        Decision(String error, String warning) { this.error = error; this.warning = warning; }
        public String error() { return error; }
        public String warning() { return warning; }
    }
}
