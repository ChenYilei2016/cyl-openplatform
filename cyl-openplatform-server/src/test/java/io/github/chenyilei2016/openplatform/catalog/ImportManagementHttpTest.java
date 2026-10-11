package io.github.chenyilei2016.openplatform.catalog;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import io.github.chenyilei2016.openplatform.application.importing.ApiImportReceiptRepository;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.CredentialSecrets;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
@SpringBootTest(properties = {

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=VIEW_AUDIT",
        "test.admin.operators[0].permissions[2]=MANAGE_APPLICATIONS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=operator-2",
        "test.admin.operators[1].permissions[0]=MANAGE_APIS",
        "test.admin.operators[2].tenant-id=tenant-2",
        "test.admin.operators[2].employee-no=operator-1",
        "test.admin.operators[2].permissions[0]=MANAGE_APIS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class ImportManagementHttpTest {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;
    @MockitoBean AccountAuthentication identityService;
    @MockitoSpyBean ApiImportReceiptRepository receipts;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(12L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    @Test
    void unsupportedFieldsExplainFixAndPreserveRecognizedOperationWithoutAllowingWrites() throws Exception {
        ObjectNode source = draft().put("expectedRevision", 2).put("protocol", "HTTP").put("id", "private-record-value")
                .put("unexpectedField", "secret-value-must-not-echo");
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(source.toString()));
        JsonNode item = preview.at("/items/0");
        assertThat(item.get("change").asText()).isEqualTo("ERROR");
        assertThat(item.at("/operation/service").asText()).isEqualTo(source.get("service").asText());
        assertThat(item.at("/operation/version").asText()).isEqualTo("v1");
        assertThat(item.at("/operation/method").asText()).isEqualTo("query");
        assertThat(item.get("after").isNull()).isTrue();
        assertThat(item.get("errors").toString()).contains("expectedRevision", "请删除", "binding.protocol", "服务端字段 id", "unexpectedField")
                .doesNotContain("private-record-value", "secret-value-must-not-echo");
        long before = database.queryForObject("SELECT COUNT(*) FROM catalog_api_draft", Long.class);
        String rejectedBody = mvc.perform(auth(post("/admin-api/api-imports/confirm").content(confirmation(source, preview, 0).toString())))
                .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
        JsonNode rejected = json.readTree(rejectedBody).get("data");
        assertThat(rejected.get("committed").asBoolean()).isFalse();
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_draft", Long.class)).isEqualTo(before);
        source.remove(java.util.List.of("expectedRevision", "protocol", "id", "unexpectedField"));
        JsonNode corrected = send(post("/admin-api/api-imports/preview").content(source.toString()));
        assertThat(corrected.at("/items/0/change").asText()).isEqualTo("CREATE");
    }

    @Test
    void wrongItemShapeAndUnprintableFieldNamesGiveSafeSpecificFeedback() throws Exception {
        ObjectNode source = draft().put("bad\nsecret-key", "secret-value");
        ObjectNode document = bundle(source);
        ((tools.jackson.databind.node.ArrayNode) document.get("apis")).add("secret-text-item");
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(document.toString()));
        assertThat(preview.at("/items/0/errors").toString()).contains("特殊字符").doesNotContain("secret-key", "secret-value");
        assertThat(preview.at("/items/1/errors").toString()).contains("JSON 对象", "修正此项").doesNotContain("secret-text-item");
    }

    @Test
    void fieldTypeErrorsStayPerItemAndKeepValidIdentifiers() throws Exception {
        ObjectNode source = draft().put("employeeRequired", "private-invalid-boolean");
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(source.toString()));
        assertThat(preview.at("/items/0/change").asText()).isEqualTo("ERROR");
        assertThat(preview.at("/items/0/operation/service").asText()).isEqualTo(source.get("service").asText());
        assertThat(preview.at("/items/0/errors").toString()).contains("employeeRequired", "类型或结构")
                .doesNotContain("private-invalid-boolean");
    }

    @Test
    void nativeExportAndImportKeepRequiredEmployeeIdentity() throws Exception {
        ObjectNode source = draft().put("employeeRequired", true);
        source.set("responseAdapter", json.readTree("{\"mode\":\"ENVELOPE\",\"successPath\":\"code\",\"successValues\":[200],\"dataPath\":\"data\"}"));

        String id = send(post("/admin-api/apis").content(source.toString())).get("id").asText();
        JsonNode exported = send(get("/admin-api/api-imports/exports/" + id).param("revision", "1"));
        assertThat(exported.at("/apis/0/employeeRequired").asBoolean()).isTrue();
        ((ObjectNode) exported.at("/apis/0")).put("method", "copied_employee");
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(exported.toString()));
        assertThat(preview.at("/items/0/after/employeeRequired").asBoolean()).isTrue();
        JsonNode result = send(post("/admin-api/api-imports/confirm").content(confirmation(exported, preview, 0).toString()));
        String imported = result.at("/items/0/apiId").asText();
        assertThat(imported).matches("API_[0-9a-f]{32}");
        assertThat(send(get("/admin-api/apis/" + imported)).get("employeeRequired").asBoolean()).isTrue();
        assertThat(send(get("/admin-api/apis/" + imported)).at("/responseAdapter/successValues/0").asInt()).isEqualTo(200);
    }

    @Test
    void previewsWithoutWritesAndImportsOnlyExplicitValidSelections() throws Exception {
        ObjectNode valid = draft().put("description", "可导入的独立说明");
        ((ObjectNode) valid.at("/binding/http")).put("sourceClass", "com.example.ImportSearch").put("sourceMethod", "lookup");
        ObjectNode invalid = draft().put("name", "");
        JsonNode document = bundle(valid, invalid);
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(document.toString()));
        assertThat(preview.at("/items/0/change").asText()).isEqualTo("CREATE");
        assertThat(preview.at("/items/1/change").asText()).isEqualTo("ERROR");
        assertThat(send(get("/admin-api/apis").param("query", valid.get("service").asText())).get("total").asInt()).isZero();
        ObjectNode confirmation = confirmation(document, preview, 0);
        JsonNode result = send(post("/admin-api/api-imports/confirm").content(confirmation.toString()));
        assertThat(result.get("committed").asBoolean()).isTrue();
        String id = result.at("/items/0/apiId").asText();
        JsonNode matches = send(get("/admin-api/apis").param("query", valid.path("service").asText())
                .param("internalClass", "com.example.ImportSearch").param("internalMatch", "EXACT").param("internalMethod", "lookup"));
        assertThat(matches.path("total").asInt()).isEqualTo(1);
        assertThat(matches.at("/items/0/id").asText()).isEqualTo(id);
        assertThat(send(get("/admin-api/apis/" + id)).get("draftRevision").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/apis/" + id + "/revisions/1")).get("source").asText())
                .isEqualTo("IMPORT_CREATE_API_DRAFT");
        assertThat(send(get("/admin-api/apis/" + id)).get("description").asText()).isEqualTo("可导入的独立说明");
        mvc.perform(auth(post("/admin-api/api-imports/confirm").content(confirmation.toString())))
                .andExpect(status().isConflict());
        JsonNode again = send(post("/admin-api/api-imports/preview").content(document.toString()));
        assertThat(again.at("/items/0/change").asText()).isEqualTo("UNCHANGED");
        valid.remove("description");
        JsonNode missing = send(post("/admin-api/api-imports/preview").content(bundle(valid).toString()));
        assertThat(missing.at("/items/0/change").asText()).isEqualTo("ERROR");
        assertThat(missing.at("/items/0/errors").toString()).contains("description");
    }

    @Test
    void rejectsWholeSelectedBatchWhenOneRevisionIsStale() throws Exception {
        ObjectNode existing = draft();
        JsonNode created = send(post("/admin-api/apis").content(existing.toString()));
        ObjectNode incoming = existing.deepCopy().put("name", "导入更新");
        ObjectNode newApi = draft();
        JsonNode document = bundle(incoming, newApi);
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(document.toString()));
        assertThat(preview.at("/items/0/changedFields").toString()).contains("name");
        send(put("/admin-api/apis/" + created.get("id").asText())
                .content(existing.deepCopy().put("name", "并发修改").put("expectedRevision", 1).toString()));
        ObjectNode confirm = confirmation(document, preview, 0, 1);
        var rejected = mvc.perform(auth(post("/admin-api/api-imports/confirm").content(confirm.toString())))
                .andExpect(status().isConflict()).andReturn();
        JsonNode data = json.readTree(rejected.getResponse().getContentAsString()).get("data");
        assertThat(data.get("committed").asBoolean()).isFalse();
        assertThat(data.get("items").size()).isEqualTo(2);
        assertThat(send(get("/admin-api/apis").param("query", newApi.get("service").asText())).get("total").asInt()).isZero();
        assertThat(send(get("/admin-api/apis/" + created.get("id").asText())).get("name").asText()).isEqualTo("并发修改");
    }

    @Test
    void reportsDuplicateOperationsAndKeepsUnchangedSelectionWithoutRevision() throws Exception {
        ObjectNode source = draft();
        JsonNode duplicate = send(post("/admin-api/api-imports/preview").content(bundle(source, source).toString()));
        assertThat(duplicate.at("/items/0/change").asText()).isEqualTo("ERROR");
        assertThat(duplicate.at("/items/1/change").asText()).isEqualTo("ERROR");
        JsonNode created = send(post("/admin-api/apis").content(source.toString()));
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(source.toString()));
        JsonNode unchanged = send(post("/admin-api/api-imports/confirm").content(confirmation(source, preview, 0).toString()));
        assertThat(unchanged.at("/items/0/change").asText()).isEqualTo("UNCHANGED");
        assertThat(unchanged.at("/items/0/revision").asLong()).isEqualTo(1);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=?", Long.class,
                created.get("id").asText())).isEqualTo(1);
        assertThat(send(get("/admin-api/apis/" + created.get("id").asText())).get("draftRevision").asLong()).isEqualTo(1);
        assertThat(send(get("/admin-api/apis/" + created.get("id").asText() + "/revisions")).get("total").asInt()).isEqualTo(1);
    }

    @Test
    void commitsMixedBatchUpdatesWithIndependentValuesAndVisibleAudit() throws Exception {
        ObjectNode first = draft();
        ObjectNode second = draft();
        String firstId = send(post("/admin-api/apis").content(first.toString())).get("id").asText();
        String secondId = send(post("/admin-api/apis").content(second.toString())).get("id").asText();
        // 两条旧稿缺少历史：批量导入仍按批归档，不逐API查询。
        database.update("DELETE FROM catalog_api_revision WHERE api_id IN (?, ?)", firstId, secondId);
        first.put("name", "第一条更新"); second.put("name", "第二条更新");
        ObjectNode added = draft();
        JsonNode document = bundle(first, second, added);
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(document.toString()));
        JsonNode result = send(post("/admin-api/api-imports/confirm").content(confirmation(document, preview, 0, 1, 2).toString()));
        assertThat(result.get("items").size()).isEqualTo(3);
        assertThat(send(get("/admin-api/apis/" + firstId)).get("name").asText()).isEqualTo("第一条更新");
        JsonNode saved = send(get("/admin-api/apis/" + secondId));
        assertThat(saved.get("name").asText()).isEqualTo("第二条更新");
        assertThat(saved.get("draftRevision").asLong()).isEqualTo(2);
        assertThat(saved.at("/responseSchema/example").decimalValue()).isEqualByComparingTo("101.25");
        JsonNode audits = send(get("/admin-api/observability/audits").param("apiId", firstId));
        assertThat(audits.get("items").toString()).contains("IMPORT_UPDATE_API_DRAFT", "operator-1")
                .doesNotContain("internal.example");
        assertThat(audits.get("total").asInt()).isEqualTo(2);
        for (String id : java.util.List.of(firstId, secondId)) {
            assertThat(send(get("/admin-api/apis/" + id + "/revisions")).get("total").asInt()).isEqualTo(2);
            assertThat(send(get("/admin-api/apis/" + id + "/revisions/1")).get("source").asText()).isEqualTo("HISTORY_BASELINE");
            assertThat(send(get("/admin-api/apis/" + id + "/revisions/2")).get("source").asText()).isEqualTo("IMPORT_UPDATE_API_DRAFT");
        }
        String addedId = result.at("/items/2/apiId").asText();
        assertThat(send(get("/admin-api/apis/" + addedId + "/revisions/1")).get("source").asText()).isEqualTo("IMPORT_CREATE_API_DRAFT");
    }

    @Test
    void rejectsWholeBatchWhenScopeIsDisabledAfterPreview() throws Exception {
        String code = "import." + UUID.randomUUID().toString().replace("-", "");
        String scopeId = send(post("/admin-api/scopes").content("""
                {"code":"%s","name":"导入权限组","enabled":true,"defaultForNewApplication":false}
                """.formatted(code))).get("id").asText();
        ObjectNode restricted = draft();
        restricted.putArray("scopeCodes").add(code);
        ObjectNode unrestricted = draft();
        JsonNode document = bundle(restricted, unrestricted);
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(document.toString()));
        send(put("/admin-api/scopes/" + scopeId).content("""
                {"name":"导入权限组","enabled":false,"defaultForNewApplication":false}
                """));
        mvc.perform(auth(post("/admin-api/api-imports/confirm").content(confirmation(document, preview, 0, 1).toString())))
                .andExpect(status().isBadRequest());
        assertThat(send(get("/admin-api/apis").param("query", restricted.get("service").asText())).get("total").asInt()).isZero();
        assertThat(send(get("/admin-api/apis").param("query", unrestricted.get("service").asText())).get("total").asInt()).isZero();
    }

    @Test
    void openApiCandidatesCompleteThroughImportAndReplayOnlyWithinTheirTrustedActor() throws Exception {
        String source = """
                {"openapi":"3.0.3","info":{"title":"HTTP接入验收","version":"1"},
                 "servers":[{"url":"https://internal.example"}],"paths":{"/orders/query":{"post":{
                   "summary":"来源订单查询","description":"从来源补齐的说明",
                   "requestBody":{"content":{"application/json":{"schema":{"type":"object",
                     "properties":{"orderId":{"type":"string","description":"订单编号"}}}}}},
                   "responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"number","example":101.25}}}}}
                 }}}}
                """;
        Long draftsBefore = database.queryForObject("SELECT COUNT(*) FROM catalog_api_draft", Long.class);
        Long receiptsBefore = database.queryForObject("SELECT COUNT(*) FROM catalog_api_import_request", Long.class);
        JsonNode candidates = send(post("/admin-api/api-imports/sources/openapi").content(source));
        assertThat(candidates.get("items").size()).isEqualTo(1);
        assertThat(candidates.at("/items/0/blockers").size()).isZero();
        assertThat(candidates.at("/items/0/definition/service").asText()).isEmpty();
        assertThat(candidates.at("/items/0/definition/scopeCodes").size()).isZero();
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_draft", Long.class)).isEqualTo(draftsBefore);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_import_request", Long.class)).isEqualTo(receiptsBefore);
        ObjectNode completed = (ObjectNode) candidates.at("/items/0/definition").deepCopy();
        completed.remove("id"); completed.remove("draftRevision"); completed.remove("protocol");
        completed.put("service", "openapi_" + UUID.randomUUID().toString().replace("-", ""))
                .put("version", "v1").put("method", "query").put("category", "订单").put("owner", "接入维护者");
        completed.putArray("mappings").addObject().put("target", "orderId").put("source", "REQUEST").put("path", "orderId");
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(completed.toString()));
        assertThat(preview.at("/items/0/change").asText()).isEqualTo("CREATE");
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_draft", Long.class)).isEqualTo(draftsBefore);
        String key = UUID.randomUUID().toString();
        ObjectNode submit = confirmation(completed, preview, 0).put("submissionKey", key)
                .put("sourceKind", "OPENAPI").put("sourceDigest", candidates.get("sourceDigest").asText());
        JsonNode result = send(post("/admin-api/api-imports/confirm").content(submit.toString()));
        assertThat(result.get("committed").asBoolean()).isTrue();
        assertThat(send(get("/admin-api/api-imports/requests/" + key))).isEqualTo(result);
        assertThat(send(post("/admin-api/api-imports/confirm").content(submit.toString()))).isEqualTo(result);
        String id = result.at("/items/0/apiId").asText();
        JsonNode saved = send(get("/admin-api/apis/" + id));
        assertThat(saved.get("draftRevision").asLong()).isEqualTo(1);
        assertThat(saved.get("name").asText()).isEqualTo("来源订单查询");
        assertThat(saved.at("/requestSchema/properties/orderId/description").asText()).isEqualTo("订单编号");
        assertThat(saved.at("/responseSchema/example").decimalValue()).isEqualByComparingTo("101.25");
        assertThat(send(get("/admin-api/apis/" + id + "/revisions")).get("total").asLong()).isEqualTo(1);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_audit WHERE api_id=?", Long.class, id)).isEqualTo(1);
        assertThat(database.queryForObject("SELECT source_digest FROM catalog_api_import_request WHERE submission_key=?", String.class, key))
                .isEqualTo(candidates.get("sourceDigest").asText());
        assertThat(database.queryForObject("SELECT source_kind FROM catalog_api_import_request WHERE submission_key=?", String.class, key)).isEqualTo("OPENAPI");
        JsonNode provenance = send(get("/admin-api/api-imports/provenance/" + id).param("revision", "1"));
        assertThat(provenance.get("apiId").asText()).isEqualTo(id);
        assertThat(provenance.get("revision").asLong()).isEqualTo(1);
        assertThat(provenance.get("sourceKind").asText()).isEqualTo("OPENAPI");
        assertThat(provenance.get("sourceLabel").asText()).isEqualTo("OpenAPI 3.0 JSON 接口文档");
        assertThat(provenance.get("sourceDigest").asText()).isEqualTo(candidates.get("sourceDigest").asText());
        assertThat(provenance.toString()).doesNotContain("submissionKey", "operatorTenantId", "operatorEmployeeNo", "internal.example");
        mvc.perform(get("/admin-api/api-imports/provenance/" + id).param("revision", "1")).andExpect(status().isUnauthorized());
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_import_revision WHERE api_id=?", Long.class, id)).isEqualTo(1);

        ObjectNode changed = completed.deepCopy().put("name", "同键不同内容");
        JsonNode nextPreview = send(post("/admin-api/api-imports/preview").content(changed.toString()));
        ObjectNode conflicting = confirmation(changed, nextPreview, 0).put("submissionKey", key)
                .put("sourceKind", "OPENAPI").put("sourceDigest", candidates.get("sourceDigest").asText());
        mvc.perform(auth(post("/admin-api/api-imports/confirm").content(conflicting.toString()))).andExpect(status().isConflict());
        assertThat(send(get("/admin-api/api-imports/requests/" + key))).isEqualTo(result);
        assertThat(send(get("/admin-api/apis/" + id))).isEqualTo(saved);
        for (String[] identity : new String[][]{{"tenant-1", "operator-2"}, {"tenant-2", "operator-1"}}) {
            TestAccount other = new TestAccount();
            other.setId(13L); other.setTenantId(identity[0]); other.setEmployeeNoStr(identity[1]);
            when(identityService.current("test-session")).thenAnswer(invocation -> other.toAccount());
            mvc.perform(auth(get("/admin-api/api-imports/requests/" + key))).andExpect(status().isNotFound());
        }
    }

    @Test
    void receiptFailureAfterDraftWritesRollsBackTheWholeSubmission() throws Exception {
        ObjectNode first = draft();
        ObjectNode second = draft();
        JsonNode document = bundle(first, second);
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(document.toString()));
        String key = UUID.randomUUID().toString();
        ObjectNode submit = confirmation(document, preview, 0, 1).put("submissionKey", key)
                .put("sourceKind", "PLATFORM").put("sourceDigest", preview.get("documentDigest").asText());
        doAnswer(invocation -> {
            invocation.callRealMethod();
            throw new PlatformException(ErrorCode.INTERNAL_ERROR, "injected failure after receipt and provenance write");
        }).when(receipts).complete(any(), anyString(), any());
        mvc.perform(auth(post("/admin-api/api-imports/confirm").content(submit.toString()))).andExpect(status().isInternalServerError());
        mvc.perform(auth(get("/admin-api/api-imports/requests/" + key))).andExpect(status().isNotFound());
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_import_request WHERE submission_key=?", Long.class, key)).isZero();
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_import_revision WHERE submission_key=?", Long.class, key)).isZero();
        assertThat(send(get("/admin-api/apis").param("query", first.get("service").asText())).get("total").asLong()).isZero();
        assertThat(send(get("/admin-api/apis").param("query", second.get("service").asText())).get("total").asLong()).isZero();
    }

    @Test
    void configurationExportRemovesActualSecretsAndServerMetadataButPreservesBusinessFieldsAndLifecycle() throws Exception {
        ObjectNode source = draft().put("description", "普通业务说明");
        ((ObjectNode) source.at("/binding/http")).put("url", "https://internal.example/orders/query?clientSecret=url-secret-value&%74oken=url-token-value&region=cn");
        source.set("responseSchema", json.readTree("""
                {"type":"OBJECT","properties":{
                  "clientSecret":{"type":"STRING","defaultValue":"schema-secret-default","example":"schema-secret-example","enumValues":["schema-secret-default","schema-secret-example"]},
                  "token":{"type":"STRING","example":"schema-token-value"},
                  "orderStatus":{"type":"STRING","example":"READY"}},
                 "example":{"clientSecret":"schema-secret-example","token":"schema-token-value","orderStatus":"READY"}}
                """));
        source.set("mappings", json.readTree("""
                [{"target":"orderId","source":"REQUEST","path":"orderId"},
                 {"target":"clientSecret","source":"FIXED","value":"fixed-secret-value"},
                 {"target":"payload","source":"FIXED","value":{"region":"cn","token":"nested-token-value","details":[{"clientSecret":"nested-secret-value","label":"ordinary"}]}}]
                """));
        ObjectNode lifecycle = (ObjectNode) json.readTree("""
                {"status":"DEPRECATED","compatibility":"COMPATIBLE","compatibilityNotes":"保留原请求字段",
                 "deprecationNotice":"请逐步迁移v2","replacementVersion":"v2","sunsetDate":"2027-12-31"}
                """);
        source.set("lifecycle", lifecycle);
        JsonNode created = send(post("/admin-api/apis").content(source.toString()));
        String id = created.get("id").asText();
        JsonNode exported = send(get("/admin-api/api-imports/exports/" + id).param("revision", "1"));
        assertThat(exported.get("format").asText()).isEqualTo("cyl-openplatform.catalog/v1");
        assertThat(exported.get("apis").size()).isEqualTo(1);
        JsonNode config = exported.at("/apis/0");
        assertThat(config.has("id")).isFalse();
        assertThat(config.has("draftRevision")).isFalse();
        assertThat(config.has("operatorTenantId")).isFalse();
        assertThat(config.has("operatorEmployeeNo")).isFalse();
        assertThat(config.has("requestId")).isFalse();
        assertThat(config.get("service")).isEqualTo(source.get("service"));
        assertThat(config.get("owner")).isEqualTo(source.get("owner"));
        assertThat(config.get("description").asText()).isEqualTo("普通业务说明");
        assertThat(config.get("requestSchema")).isEqualTo(created.get("requestSchema"));
        assertThat(config.get("lifecycle")).isEqualTo(lifecycle);
        assertThat(config.at("/binding/http/url").asText()).isEqualTo("https://internal.example/orders/query?region=cn");
        assertThat(config.at("/responseSchema/properties/clientSecret/defaultValue").isNull()).isTrue();
        assertThat(config.at("/responseSchema/properties/clientSecret/example").isNull()).isTrue();
        assertThat(config.at("/responseSchema/properties/clientSecret/enumValues").size()).isZero();
        assertThat(config.at("/responseSchema/properties/token/example").isNull()).isTrue();
        assertThat(config.at("/responseSchema/example").isNull()).isTrue();
        assertThat(config.at("/responseSchema/properties/orderStatus/example").asText()).isEqualTo("READY");
        assertThat(config.at("/mappings/0/path").asText()).isEqualTo("orderId");
        assertThat(config.at("/mappings/1/value").isNull()).isTrue();
        assertThat(config.at("/mappings/2/value/region").asText()).isEqualTo("cn");
        assertThat(config.at("/mappings/2/value").has("token")).isFalse();
        assertThat(config.at("/mappings/2/value/details/0").has("clientSecret")).isFalse();
        assertThat(config.at("/mappings/2/value/details/0/label").asText()).isEqualTo("ordinary");
        assertThat(exported.toString()).doesNotContain("url-secret-value", "url-token-value", "schema-secret-default", "schema-secret-example",
                "schema-token-value", "fixed-secret-value", "nested-token-value", "nested-secret-value", "operator-1", "tenant-1");
        assertThat(send(get("/admin-api/apis/" + id))).isEqualTo(created);
        mvc.perform(auth(get("/admin-api/api-imports/exports/" + id).param("revision", "2"))).andExpect(status().isConflict());
    }

    @Test
    void invalidHttpAddressRejectsTheWholeBatchEvenWhenConfirmationSkipsPreview() throws Exception {
        ObjectNode permitted = draft();
        ObjectNode rejected = draft();
        ((ObjectNode) rejected.at("/binding/http")).put("url", "https://user:password@internal.example/platform-info");
        JsonNode document = bundle(permitted, rejected);
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(document.toString()));
        assertThat(preview.at("/items/0/change").asText()).isEqualTo("CREATE");
        assertThat(preview.at("/items/1/change").asText()).isEqualTo("ERROR");
        assertThat(preview.at("/items/1/errors").toString()).contains("HTTP地址");
        assertThat(preview.at("/items/1/warnings").size()).isZero();
        // 模拟未使用预览返回值、直接按原生文档摘要提交；确认必须独立执行环境校验。
        String digest = CredentialSecrets.digest(document.toString());
        String key = UUID.randomUUID().toString();
        ObjectNode direct = json.createObjectNode().put("documentDigest", digest).put("submissionKey", key)
                .put("sourceKind", "PLATFORM").put("sourceDigest", digest);
        direct.set("document", document);
        direct.putArray("selections").addObject().put("index", 0).put("expectedRevision", 0);
        ((tools.jackson.databind.node.ArrayNode) direct.get("selections")).addObject().put("index", 1).put("expectedRevision", 0);
        String response = mvc.perform(auth(post("/admin-api/api-imports/confirm").content(direct.toString())))
                .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(response).at("/data/committed").asBoolean()).isFalse();
        assertThat(json.readTree(response).at("/data/items/1/errors").toString()).contains("HTTP地址");
        assertThat(send(get("/admin-api/apis").param("query", permitted.get("service").asText())).get("total").asLong()).isZero();
        assertThat(send(get("/admin-api/apis").param("query", rejected.get("service").asText())).get("total").asLong()).isZero();
        mvc.perform(auth(get("/admin-api/api-imports/requests/" + key))).andExpect(status().isNotFound());
        JsonNode candidates = send(post("/admin-api/api-imports/sources/openapi").content("""
                {"openapi":"3.0.3","info":{"title":"仍可离线解析","version":"1"},"servers":[{"url":"http://127.0.0.1:8080"}],
                 "paths":{"/platform-info":{"get":{"responses":{"200":{"description":"成功","content":{"application/json":{"schema":{"type":"string"}}}}}}}}}
                """));
        assertThat(candidates.at("/items/0/blockers").size()).isZero();
        assertThat(candidates.at("/items/0/definition/binding/http/url").asText()).isEqualTo("http://127.0.0.1:8080/platform-info");
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_import_revision WHERE submission_key=?", Long.class, key)).isZero();
    }

    @Test
    void importsNewAndChangedOriginsWithoutDeploymentPermission() throws Exception {
        ObjectNode source = draft();
        ((ObjectNode) source.at("/binding/http")).put("url", "https://legacy.example/old");
        JsonNode created = send(post("/admin-api/apis").content(source.toString()));
        String id = created.get("id").asText();
        JsonNode unchanged = send(post("/admin-api/api-imports/preview").content(source.toString()));
        assertThat(unchanged.at("/items/0/change").asText()).isEqualTo("UNCHANGED");
        assertThat(unchanged.at("/items/0/warnings").size()).isZero();
        source.put("name", "保留原origin更新");
        ((ObjectNode) source.at("/binding/http")).put("url", "HTTPS://LEGACY.EXAMPLE:443/new");
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(source.toString()));
        assertThat(preview.at("/items/0/change").asText()).isEqualTo("UPDATE");
        assertThat(preview.at("/items/0/errors").size()).isZero();
        assertThat(preview.at("/items/0/warnings").size()).isZero();
        send(post("/admin-api/api-imports/confirm").content(confirmation(source, preview, 0).toString()));
        JsonNode imported = send(get("/admin-api/apis/" + id));
        assertThat(imported.get("draftRevision").asLong()).isEqualTo(2);
        ((ObjectNode) source.at("/binding/http")).put("url", "https://different.example/new");
        JsonNode changedOrigin = send(post("/admin-api/api-imports/preview").content(source.toString()));
        assertThat(changedOrigin.at("/items/0/change").asText()).isEqualTo("UPDATE");
        send(post("/admin-api/api-imports/confirm").content(confirmation(source, changedOrigin, 0).toString()));
        assertThat(send(get("/admin-api/apis/" + id)).at("/binding/http/url").asText()).isEqualTo("https://different.example/new");
        source.put("expectedRevision", 3);
        source.put("name", "手动保存同样无需目标许可");
        JsonNode manual = send(put("/admin-api/apis/" + id).content(source.toString()));
        assertThat(manual.at("/binding/http/url").asText()).isEqualTo("https://different.example/new");
    }

    @Test
    void unchangedImportKeepsOriginalProvenanceAndUpdatesAttachOnlyTheirNewRevision() throws Exception {
        ObjectNode source = draft();
        JsonNode preview = send(post("/admin-api/api-imports/preview").content(source.toString()));
        String firstKey = UUID.randomUUID().toString();
        ObjectNode initial = confirmation(source, preview, 0).put("submissionKey", firstKey).put("sourceKind", "PLATFORM")
                .put("sourceDigest", preview.get("documentDigest").asText());
        JsonNode created = send(post("/admin-api/api-imports/confirm").content(initial.toString()));
        String id = created.at("/items/0/apiId").asText();
        JsonNode firstSource = send(get("/admin-api/api-imports/provenance/" + id).param("revision", "1"));
        JsonNode unchangedPreview = send(post("/admin-api/api-imports/preview").content(source.toString()));
        String unchangedKey = UUID.randomUUID().toString();
        ObjectNode unchanged = confirmation(source, unchangedPreview, 0).put("submissionKey", unchangedKey).put("sourceKind", "HTTP")
                .put("sourceDigest", CredentialSecrets.digest("different source with identical completed configuration"));
        JsonNode noChange = send(post("/admin-api/api-imports/confirm").content(unchanged.toString()));
        assertThat(noChange.at("/items/0/change").asText()).isEqualTo("UNCHANGED");
        assertThat(send(get("/admin-api/api-imports/provenance/" + id).param("revision", "1"))).isEqualTo(firstSource);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_import_revision WHERE submission_key=?", Long.class, unchangedKey)).isZero();

        source.put("name", "另一份配置更新名称");
        JsonNode updatePreview = send(post("/admin-api/api-imports/preview").content(source.toString()));
        ObjectNode updated = confirmation(source, updatePreview, 0).put("submissionKey", UUID.randomUUID().toString())
                .put("sourceKind", "PLATFORM").put("sourceDigest", updatePreview.get("documentDigest").asText());
        JsonNode changed = send(post("/admin-api/api-imports/confirm").content(updated.toString()));
        assertThat(changed.at("/items/0/change").asText()).isEqualTo("UPDATE");
        assertThat(changed.at("/items/0/revision").asLong()).isEqualTo(2);
        assertThat(send(post("/admin-api/api-imports/confirm").content(updated.toString()))).isEqualTo(changed);
        JsonNode secondSource = send(get("/admin-api/api-imports/provenance/" + id).param("revision", "2"));
        assertThat(secondSource.get("sourceDigest").asText()).isEqualTo(updatePreview.get("documentDigest").asText());
        assertThat(secondSource.get("sourceLabel").asText()).isEqualTo("平台接口配置 JSON");
        assertThat(send(get("/admin-api/api-imports/provenance/" + id).param("revision", "1"))).isEqualTo(firstSource);
        assertThat(database.queryForObject("SELECT COUNT(*) FROM catalog_api_import_revision WHERE api_id=?", Long.class, id)).isEqualTo(2);
        String manualId = send(post("/admin-api/apis").content(draft().toString())).get("id").asText();
        String missing = mvc.perform(auth(get("/admin-api/api-imports/provenance/" + manualId).param("revision", "1")))
                .andExpect(status().isNotFound()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(missing).get("resultMsg").asText()).contains("该修订未记录导入来源");
    }

    private ObjectNode draft() {
        return (ObjectNode) json.readTree("""
                {"service":"import_%s","version":"v1","method":"query","name":"订单查询","category":"订单","owner":"研发",
                 "scopeCodes":[],"requestSchema":{"type":"OBJECT","properties":{"orderId":{"type":"STRING"}}},
                 "responseSchema":{"type":"NUMBER","example":101.25},"errorDefinitions":[],
                 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/orders/query","method":"POST"}},
                 "mappings":[{"target":"orderId","source":"REQUEST","path":"orderId"}]}
                """.formatted(UUID.randomUUID().toString().replace("-", "")));
    }

    private ObjectNode bundle(ObjectNode... definitions) {
        ObjectNode result = json.createObjectNode().put("format", "cyl-openplatform.catalog/v1");
        var apis = result.putArray("apis");
        for (var definition : definitions) apis.add(definition);
        return result;
    }

    private ObjectNode confirmation(JsonNode document, JsonNode preview, int... indices) {
        ObjectNode result = json.createObjectNode().put("documentDigest", preview.get("documentDigest").asText());
        result.set("document", document);
        var selected = result.putArray("selections");
        for (int index : indices) selected.addObject().put("index", index)
                .put("expectedRevision", preview.at("/items/" + index + "/expectedRevision").asLong());
        return result;
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        var result = mvc.perform(auth(request)).andReturn();
        assertThat(result.getResponse().getStatus()).as(result.getResponse().getContentAsString()).isEqualTo(200);
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }
}
