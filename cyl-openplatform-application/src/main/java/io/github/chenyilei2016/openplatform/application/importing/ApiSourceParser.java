package io.github.chenyilei2016.openplatform.application.importing;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import java.util.List;

/** 离线解析来源；候选只在内存中补齐，不能直接作为已验证草稿写入。 */
public interface ApiSourceParser {
    Result parse(String document);

    record Result(String sourceDigest, List<Candidate> items) {
        public Result { items = List.copyOf(items); }
    }

    record Candidate(String key, String label, ApiDefinition definition, List<String> warnings, List<String> blockers) {
        public Candidate { warnings = List.copyOf(warnings); blockers = List.copyOf(blockers); }
    }
}
