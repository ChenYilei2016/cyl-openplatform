package io.github.chenyilei2016.openplatform.importing;

import io.github.chenyilei2016.openplatform.application.importing.ApiSourceParser;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.infrastructure.importing.OpenApiSourceParser;
import com.sun.net.httpserver.HttpServer;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 纯离线解析器检查，不启动Spring、不调用提供方。 */
class OpenApiSourceParserTest {
    private final OpenApiSourceParser parser = new OpenApiSourceParser();
    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void keepsPlainPathQueryAndJsonBodyPositionsInOfflineCandidates() {
        String input = """
                {"openapi":"3.0.3","info":{"title":"路径查询","version":"1"},
                 "servers":[{"url":"https://provider.example/api"}],
                 "paths":{"/orders/{orderId}":{"post":{"parameters":[
                   {"name":"orderId","in":"path","required":true,"schema":{"type":"string"}},
                   {"name":"orderId","in":"query","schema":{"type":"string"}}],
                   "requestBody":{"content":{"application/json":{"schema":{"type":"object","properties":{"orderId":{"type":"string"}}}}}},
                   "responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"string"}}}}}}}}}
                """;
        ApiSourceParser.Candidate candidate = parser.parse(input).items().getFirst();
        assertThat(candidate.blockers()).isEmpty();
        assertThat(candidate.definition().binding().http().url()).isEqualTo("https://provider.example/api/orders/{orderId}");
        assertThat(candidate.definition().mappings()).extracting(mapping -> mapping.location().name()).containsExactly("PATH", "QUERY", "BODY");
        assertThat(candidate.definition().mappings()).extracting(mapping -> mapping.target()).containsExactly("orderId", "orderId", "orderId");
        assertThat(candidate.definition().mappings()).extracting(mapping -> mapping.path()).containsExactly("orderId", "query_orderId", "body_orderId");
    }

    @Test
    void mapsLocalReferencesNestedFieldsAndExactNumbersWithoutInventingExternalIdentity() {
        String input = """
                {"openapi":"3.0.3","info":{"title":"示例","version":"1"},
                 "servers":[{"url":"https://provider.example/api"}],
                 "paths":{"/orders":{"post":{"summary":"订单查询","description":"查询说明",
                   "requestBody":{"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Order"}}}},
                   "responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Order"}}}}}}}},
                 "components":{"schemas":{"Order":{"type":"object","required":["amount","count"],
                   "properties":{"amount":{"type":"number","description":"金额","default":0.12345678901234567890123456789},
                     "count":{"type":"integer","example":9007199254740993},
                     "tags":{"type":"array","items":{"type":"string","enum":["A","B"]}}},
                   "example":{"amount":0.12345678901234567890123456789,"count":9007199254740993}}}}}
                """;
        ApiSourceParser.Result result = parser.parse(input);
        ApiSourceParser.Candidate item = result.items().getFirst();
        assertThat(result.sourceDigest()).matches("[0-9a-f]{64}").isEqualTo(parser.parse(input).sourceDigest());
        assertThat(item.blockers()).isEmpty();
        assertThat(item.definition().service()).isEmpty();
        assertThat(item.definition().version()).isEmpty();
        assertThat(item.definition().method()).isEmpty();
        assertThat(item.definition().category()).isEmpty();
        assertThat(item.definition().owner()).isEmpty();
        assertThat(item.definition().scopeCodes()).isEmpty();
        assertThat(item.definition().mappings()).extracting(mapping -> mapping.location().name()).containsOnly("BODY");
        assertThat(item.definition().binding().http().url()).isEqualTo("https://provider.example/api/orders");
        assertThat(item.definition().binding().http().method()).isEqualTo("POST");
        SchemaNode request = item.definition().requestSchema();
        assertThat(request.properties().get("amount").required()).isTrue();
        assertThat(request.properties().get("amount").defaultValue()).isEqualTo(new BigDecimal("0.12345678901234567890123456789"));
        assertThat(request.properties().get("count").example().toString()).isEqualTo("9007199254740993");
        assertThat(request.properties().get("tags").items().enumValues()).containsExactly("A", "B");
        assertThat(((Map<?, ?>) request.example()).get("amount")).isEqualTo(new BigDecimal("0.12345678901234567890123456789"));
        assertThat(item.definition().responseSchema()).isEqualTo(request);
    }

    @Test
    void keepsUnsupportedOperationsSeparateAndDoesNotGuessMissingResponses() {
        String input = """
                {"openapi":"3.0.0","info":{"title":"示例","version":"1"},"paths":{
                  "/good":{"get":{"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"string"}}}}}}},
                  "/many":{"get":{"responses":{"200":{"description":"成功"},"201":{"description":"创建"}}}},
                  "/combined":{"post":{"requestBody":{"content":{"application/json":{"schema":{"allOf":[{"type":"object"}]}}}},"responses":{"204":{"description":"无内容"}}}},
                  "/media":{"get":{"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"string"}},"text/plain":{"schema":{"type":"string"}}}}}}}
                }}
                """;
        List<ApiSourceParser.Candidate> items = parser.parse(input).items();
        assertThat(items).hasSize(4);
        assertThat(items.getFirst().blockers()).isEmpty();
        assertThat(items.get(1).blockers()).anyMatch(message -> message.contains("多个2xx"));
        assertThat(items.get(1).definition().responseSchema()).isNull();
        assertThat(items.get(2).blockers()).anyMatch(message -> message.contains("allOf"));
        assertThat(items.get(2).definition().responseSchema()).isNull();
        assertThat(items.get(3).blockers()).anyMatch(message -> message.contains("多内容类型"));
    }

    @Test
    void blocksCyclesAndUnsupportedConstraintsAtTheirSchemaLocation() {
        String input = """
                {"openapi":"3.0.3","info":{"title":"示例","version":"1"},"paths":{"/tree":{"get":{
                  "responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Node"}}}}}}}},
                 "components":{"schemas":{"Node":{"type":"object","properties":{
                   "next":{"$ref":"#/components/schemas/Node"},"amount":{"type":"number","minimum":0},
                   "comment":{"type":"string","nullable":true}}}}}}
                """;
        List<String> blockers = parser.parse(input).items().getFirst().blockers();
        assertThat(blockers).anyMatch(message -> message.contains("properties.next") && message.contains("循环引用"));
        assertThat(blockers).anyMatch(message -> message.contains("amount.minimum"));
        assertThat(blockers).noneMatch(message -> message.contains("comment.nullable"));
        assertThat(parser.parse(input).items().getFirst().definition().responseSchema().properties().get("comment").nullable()).isTrue();
    }

    @Test
    void neverReadsExternalReferencesAndDoesNotCarryCredentialsOrSecretExamples() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> { calls.incrementAndGet(); exchange.sendResponseHeaders(404, -1); exchange.close(); });
        server.start();
        try {
            String input = """
                    {"openapi":"3.0.3","info":{"title":"示例","version":"1"},"servers":[{"url":"http://user:password@127.0.0.1:%d"}],
                     "paths":{"/orders":{"post":{"parameters":[
                       {"name":"Authorization","in":"header","schema":{"type":"string"},"example":"Bearer never-copy"},
                       {"name":"session","in":"cookie","schema":{"type":"string"}}],
                       "requestBody":{"content":{"application/json":{"schema":{"type":"object","properties":{
                         "orderId":{"type":"integer"},"password":{"type":"string","example":"never-copy"},"tenantId":{"type":"string"}},
                         "example":{"orderId":1,"password":"never-copy"}}}}},
                       "responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"$ref":"http://127.0.0.1:%d/schema"}}}}}}}}}
                    """.formatted(server.getAddress().getPort(), server.getAddress().getPort());
            ApiSourceParser.Candidate candidate = parser.parse(input).items().getFirst();
            assertThat(calls).hasValue(0);
            assertThat(candidate.definition().binding().http().url()).isEmpty();
            assertThat(candidate.definition().requestSchema().properties()).containsOnlyKeys("orderId");
            assertThat(candidate.definition().requestSchema().example()).isNull();
            assertThat(candidate.blockers()).anyMatch(message -> message.contains("外部") && message.contains("引用"));
            assertThat(candidate.blockers()).anyMatch(message -> message.contains("可信身份"));
            assertThat(candidate.warnings()).anyMatch(message -> message.contains("秘密"));
            assertThat(json.writeValueAsString(candidate)).doesNotContain("never-copy", "user:password");
        } finally { server.stop(0); }
    }

    @Test
    void rejectsOtherFormatsScriptsDuplicateKeysAndBoundsBeforeConversion() {
        String valid = document(Map.of("/one", Map.of("get", operation())));
        for (String input : List.of(valid.replace("3.0.3", "3.1.0"), "openapi: 3.0.3", "{\"swagger\":\"2.0\"}",
                valid.replace("示例", "<script>alert(1)</script>"), valid.replace("/one", "/<script>"),
                valid.replace("\"openapi\":", "\"openapi\":\"3.0.3\",\"openapi\":"))) {
            assertThatThrownBy(() -> parser.parse(input)).isInstanceOf(PlatformException.class);
        }
        assertThatThrownBy(() -> parser.parse(" ".repeat(262_145))).isInstanceOf(PlatformException.class);
        Map<String, Object> paths = new LinkedHashMap<>();
        for (int index = 0; index < 101; index++) paths.put("/item" + index, Map.of("get", operation()));
        assertThatThrownBy(() -> parser.parse(document(paths))).isInstanceOf(PlatformException.class).hasMessageContaining("100");
        List<Object> nodes = new ArrayList<>();
        for (int index = 0; index < 20_001; index++) nodes.add(null);
        String oversized = valid.substring(0, valid.length() - 1) + ",\"x-many\":" + json.writeValueAsString(nodes) + "}";
        assertThatThrownBy(() -> parser.parse(oversized)).isInstanceOf(PlatformException.class).hasMessageContaining("20000");
    }

    @Test
    void attachesOperationDiagnosticsOnlyToTheAffectedCandidateAndKeepsGlobalErrorsBlocking() {
        Map<String, Object> paths = new LinkedHashMap<>();
        paths.put("/good", Map.of("get", operation()));
        paths.put("/broken", Map.of("get", Map.of("summary", "缺少响应")));
        ApiSourceParser.Result parsed = parser.parse(document(paths));
        assertThat(parsed.items().getFirst().blockers()).isEmpty();
        assertThat(parsed.items().get(1).blockers()).anyMatch(message -> message.contains("responses") && message.contains("缺少必填"));
        assertThat(parsed.items().get(1).definition().responseSchema()).isNull();
        String malformedGlobal = json.writeValueAsString(Map.of("openapi", "3.0.3", "info", Map.of("version", "1"), "paths", paths));
        assertThat(parser.parse(malformedGlobal).items()).allSatisfy(candidate ->
                assertThat(candidate.blockers()).anyMatch(message -> message.contains("全局 info")));
        Map<String, Object> wrongType = new LinkedHashMap<>(operation());
        wrongType.put("summary", List.of("do-not-echo-secret-value"));
        paths.put("/broken", Map.of("get", wrongType));
        ApiSourceParser.Result invalidType = parser.parse(document(paths));
        assertThat(invalidType.items().getFirst().blockers()).isEmpty();
        assertThat(invalidType.items().get(1).blockers()).anyMatch(message -> message.contains("summary") && message.contains("类型"));
        assertThat(json.writeValueAsString(invalidType)).doesNotContain("do-not-echo-secret-value");
    }

    @Test
    void keepsHugeIntegerExamplesAsExactIntegers() {
        BigInteger value = new BigInteger("123456789012345678901234567890");
        Map<String, Object> operation = Map.of("responses", Map.of("200", Map.of("description", "成功", "content", Map.of("application/json",
                Map.of("schema", Map.of("type", "integer", "example", value))))));
        ApiSourceParser.Candidate candidate = parser.parse(document(Map.of("/number", Map.of("get", operation)))).items().getFirst();
        assertThat(candidate.definition().responseSchema().type()).isEqualTo(SchemaType.INTEGER);
        assertThat(candidate.definition().responseSchema().example()).isEqualTo(value);
    }

    private Map<String, Object> operation() {
        return Map.of("responses", Map.of("200", Map.of("description", "成功", "content", Map.of("application/json", Map.of("schema", Map.of("type", "string"))))));
    }

    private String document(Map<String, Object> paths) {
        return json.writeValueAsString(Map.of("openapi", "3.0.3", "info", Map.of("title", "示例", "version", "1"), "paths", paths));
    }
}
