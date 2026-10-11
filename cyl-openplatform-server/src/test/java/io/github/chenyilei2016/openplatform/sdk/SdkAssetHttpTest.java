package io.github.chenyilei2016.openplatform.sdk;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/sdk-asset-schema.sql",

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[0].permissions[2]=PUBLISH_APIS",
        "test.admin.operators[0].permissions[3]=REVIEW_APIS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=author",
        "test.admin.operators[1].permissions[0]=MANAGE_APIS",
        "test.admin.operators[2].tenant-id=tenant-1",
        "test.admin.operators[2].employee-no=viewer",
        "test.admin.operators[2].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class SdkAssetHttpTest {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
    @Autowired io.github.chenyilei2016.openplatform.web.shared.sdk.SdkTransferLimiter transfers;
    @MockitoBean AccountAuthentication identityService;
    private final JsonMapper json = JsonMapper.builder().enable(tools.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(9007199254740993L);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    @Test
    void inspectZipReturnsVerifiedManifestBeforeCreatingAnyAsset() throws Exception {
        Long before=jdbc.queryForObject("SELECT COUNT(*) FROM sdk_asset",Long.class);
        byte[] zip=archive("88.1.0");
        mvc.perform(auth(put("/admin-api/sdk-assets/inspect")).contentType("application/zip").content(zip))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.manifest.sdkVersion").value("88.1.0"))
                .andExpect(jsonPath("$.data.manifest.runtime").value("Java21+"))
                .andExpect(jsonPath("$.data.sizeBytes").value(zip.length)).andExpect(jsonPath("$.data.content").doesNotExist());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sdk_asset",Long.class)).isEqualTo(before);
        mvc.perform(auth(put("/admin-api/sdk-assets/inspect")).contentType("application/zip").content("not zip"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/admin-api/sdk-assets/inspect").contentType("application/zip").content(zip))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void publishesImmutableBytesAndWithdrawsCustomerVisibility() throws Exception {
        ObjectNode draft = draft();
        JsonNode view = publish(draft);
        String token = token(draft);
        JsonNode asset = create(view);
        String id = asset.get("id").asText();
        assertThat(asset.get("revision").asLong()).isEqualTo(1);
        assertThat(asset.get("kind").asText()).isEqualTo("LEGACY_API");
        mvc.perform(auth(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":1}")))
                .andExpect(status().isConflict());
        byte[] zip = archive("1.0.0");
        asset = upload(id, 1, zip);
        assertThat(asset.get("sizeBytes").asInt()).isEqualTo(zip.length);
        asset = send(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":2}"));
        mvc.perform(get("/api/sdk-assets").header("Authorization", "Bearer " + token)
                .param("service", draft.get("service").asText()).param("version", "v1").param("method", "query"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1));
        var download = mvc.perform(get("/api/sdk-assets/" + id + "/download").header("Authorization", "Bearer " + token)
                        .param("expectedRevision", "3"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff")).andReturn().getResponse();
        assertThat(download.getContentAsByteArray()).isEqualTo(zip);
        assertThat(download.getHeader("Content-Disposition")).contains("attachment", ".zip");
        mvc.perform(auth(put("/admin-api/sdk-assets/" + id).content("{\"expectedRevision\":3,\"name\":\"已发布不可改\",\"releaseNotes\":\"改\"}")))
                .andExpect(status().isConflict());
        mvc.perform(get("/api/sdk-assets/" + id + "/download").header("Authorization", "Bearer " + token).param("expectedRevision", "2"))
                .andExpect(status().isConflict()).andExpect(header().doesNotExist("Content-Disposition"));
        send(post("/admin-api/sdk-assets/" + id + "/withdraw").content("{\"expectedRevision\":3}"));
        mvc.perform(get("/api/sdk-assets/" + id).header("Authorization", "Bearer " + token)).andExpect(status().isNotFound());
        mvc.perform(auth(get("/admin-api/sdk-assets/" + id + "/download").param("expectedRevision", "4")))
                .andExpect(status().isOk());
    }

    @Test
    void validatesManifestCasAndLiteralBoundedQueries() throws Exception {
        JsonNode view = publish(draft());
        JsonNode asset = create(view);
        String id = asset.get("id").asText();
        mvc.perform(auth(put("/admin-api/sdk-assets/" + id + "/content").param("expectedRevision", "1"))
                .contentType("application/zip").content(archive("2.0.0"))).andExpect(status().isBadRequest());
        JsonNode updated = send(put("/admin-api/sdk-assets/" + id).content("{\"expectedRevision\":1,\"name\":\"SDK % literal\",\"releaseNotes\":\"<script>plain text</script>\"}"));
        assertThat(updated.get("revision").asLong()).isEqualTo(2);
        mvc.perform(auth(put("/admin-api/sdk-assets/" + id).content("{\"expectedRevision\":1,\"name\":\"stale\",\"releaseNotes\":\"stale\"}")))
                .andExpect(status().isConflict());
        mvc.perform(auth(get("/admin-api/sdk-assets").param("query", "%").param("apiId", view.at("/document/id").asText())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].payload").doesNotExist());
        mvc.perform(auth(get("/admin-api/sdk-assets").param("pageSize", "101"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/sdk-assets").param("page", "100002").param("pageSize", "1"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/sdk-assets/" + id + "/download").param("expectedRevision", "2.0"))).andExpect(status().isBadRequest());
    }

    @Test
    void requiresBusinessBearerAndHidesAssetsAfterApiDisable() throws Exception {
        JsonNode view = publish(draft());
        JsonNode asset = create(view);
        String id = asset.get("id").asText();
        mvc.perform(auth(get("/api/sdk-assets/" + id))).andExpect(status().isUnauthorized());
        mvc.perform(auth(get("/admin-api/sdk-assets/" + id + "/download").param("expectedRevision", "1")))
                .andExpect(status().isNotFound());
        ObjectNode own = draft();
        JsonNode ownView = publish(own);
        String token = token(own);
        mvc.perform(get("/api/sdk-assets").header("Authorization", "Bearer " + token)
                .param("service", view.get("service").asText()).param("version", "v1").param("method", "query"))
                .andExpect(status().isForbidden());
        String ownId = create(ownView).get("id").asText();
        upload(ownId, 1, archive("1.0.0"));
        send(post("/admin-api/sdk-assets/" + ownId + "/publish").content("{\"expectedRevision\":2}"));
        JsonNode state = send(get("/admin-api/publications/apis/" + ownView.at("/document/id").asText() + "/state"));
        send(put("/admin-api/publications/apis/" + ownView.at("/document/id").asText() + "/status")
                .content("{\"expectedStateVersion\":" + state.get("stateVersion").asText() + ",\"enabled\":false,\"reason\":\"SDK测试停用\"}"));
        mvc.perform(get("/api/sdk-assets/" + ownId).header("Authorization", "Bearer " + token)).andExpect(status().isNotFound());
    }

    @Test
    void separatesAuthorPublisherReaderAndHidesSupersededReleases() throws Exception {
        ObjectNode draft = draft();
        JsonNode view = publish(draft);
        String token = token(draft);
        String id = create(view).get("id").asText();
        upload(id, 1, archive("1.0.0"));
        TestAccount author = new TestAccount();
        author.setId(9007199254740993L);
        author.setTenantId("tenant-1");
        author.setEmployeeNoStr("author");
        when(identityService.current("test-session")).thenAnswer(invocation -> author.toAccount());
        mvc.perform(auth(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":2}")))
                .andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/sdk-assets/" + id))).andExpect(status().isOk());
        author.setEmployeeNoStr("viewer");
        mvc.perform(auth(get("/admin-api/sdk-assets/" + id))).andExpect(status().isForbidden());
        login();
        send(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":2}"));
        String apiId = view.at("/document/id").asText();
        draft.put("expectedRevision", 1).put("name", "新生效契约");
        send(put("/admin-api/apis/" + apiId).content(draft.toString()));
        JsonNode next = send(post("/admin-api/publications/apis/" + apiId + "/submissions")
                .content("{\"expectedDraftRevision\":2,\"expectedStateVersion\":2,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"更换快照\"}"));
        send(post("/admin-api/publications/" + next.get("id").asText() + "/approve").content("{\"comment\":\"通过\"}"));
        mvc.perform(get("/api/sdk-assets/" + id).header("Authorization", "Bearer " + token)).andExpect(status().isNotFound());
        mvc.perform(get("/api/sdk-assets/" + id + "/download").header("Authorization", "Bearer " + token)
                .param("expectedRevision", "3")).andExpect(status().isNotFound());
        mvc.perform(get("/api/sdk-assets").header("Authorization", "Bearer " + token)
                .param("service", draft.get("service").asText()).param("version", "v1").param("method", "query"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(auth(post("/admin-api/sdk-assets").content(json.createObjectNode()
                .put("apiId", apiId).put("releaseId", next.get("id").asText()).put("name", "禁止重用版本")
                .put("sdkVersion", "1.0.0").put("language", "JAVA").put("gatewayProtocol", "HTTP_JSON_BEARER_V1")
                .put("runtime", "Java21+").put("releaseNotes", "不可替换").toString())))
                .andExpect(status().isConflict());
    }

    @Test
    void rejectsCoercedJsonRevisionForMetadataAndStateChanges() throws Exception {
        String id = create(publish(draft())).get("id").asText();
        for (String revision : java.util.List.of("1.9", "\"1\"", "1.0", "true", "9223372036854775808")) {
            mvc.perform(auth(put("/admin-api/sdk-assets/" + id).content("{\"expectedRevision\":" + revision
                    + ",\"name\":\"不能被隐式转换更新\",\"releaseNotes\":\"保持原修订\"}")))
                    .andExpect(status().isBadRequest());
            for (String action : java.util.List.of("publish", "withdraw")) {
                mvc.perform(auth(post("/admin-api/sdk-assets/" + id + "/" + action)
                        .content("{\"expectedRevision\":" + revision + "}"))).andExpect(status().isBadRequest());
            }
        }
        mvc.perform(auth(get("/admin-api/sdk-assets/" + id))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.revision").value(1)).andExpect(jsonPath("$.data.status").value("DRAFT"));
    }

    @Test
    void publishesIndependentPlatformVersionAndPreservesLegacyIsolation() throws Exception {
        ObjectNode api = draft();
        JsonNode apiView = publish(api);
        String bearer = token(api);
        String legacyId = create(apiView).get("id").asText();
        upload(legacyId, 1, archive("1.0.0"));
        send(post("/admin-api/sdk-assets/" + legacyId + "/publish").content("{\"expectedRevision\":2}"));

        String sdkVersion = "p-" + UUID.randomUUID().toString().substring(0, 20);
        ObjectNode declaration = platformDeclaration(sdkVersion);
        JsonNode asset = send(post("/admin-api/sdk-assets").content(declaration.toString()));
        String id = asset.get("id").asText();
        assertThat(asset.get("kind").asText()).isEqualTo("PLATFORM");
        for (String field : java.util.List.of("apiId", "releaseId", "service", "version", "method"))
            assertThat(asset.get(field).isNull()).as(field).isTrue();
        mvc.perform(auth(post("/admin-api/sdk-assets").content(declaration.toString()))).andExpect(status().isConflict());
        mvc.perform(auth(post("/admin-api/sdk-assets").content(declaration.deepCopy()
                .put("apiId", apiView.at("/document/id").asText()).toString()))).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/admin-api/sdk-assets").content(declaration.deepCopy()
                .put("kind", "LEGACY_API").toString()))).andExpect(status().isBadRequest());
        mvc.perform(get("/public-api/sdk-assets/" + id + "/download").param("expectedRevision", "99"))
                .andExpect(status().isNotFound());
        byte[] zip = archive(sdkVersion);
        upload(id, 1, zip);
        send(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":2}"));
        mvc.perform(get("/public-api/sdk-assets").param("sdkVersion", sdkVersion).param("language", "JAVA").param("pageSize", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].id").value(id)).andExpect(jsonPath("$.data.items[0].payload").doesNotExist());
        mvc.perform(get("/public-api/sdk-assets").param("sdkVersion", sdkVersion).param("page", "2").param("pageSize", "1"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1)).andExpect(jsonPath("$.data.items").isEmpty());
        mvc.perform(auth(get("/admin-api/sdk-assets").param("kind", "PLATFORM").param("status", "PUBLISHED")
                .param("sdkVersion", sdkVersion).param("language", "JAVA")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/public-api/sdk-assets/" + legacyId)).andExpect(status().isNotFound());
        mvc.perform(get("/public-api/sdk-assets/" + legacyId + "/download").param("expectedRevision", "99"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/sdk-assets/" + id).header("Authorization", "Bearer " + bearer)).andExpect(status().isNotFound());
        mvc.perform(get("/public-api/sdk-assets/" + id + "/download").param("expectedRevision", "2"))
                .andExpect(status().isConflict()).andExpect(header().doesNotExist("Content-Disposition"));
        JsonNode state = send(get("/admin-api/publications/apis/" + apiView.at("/document/id").asText() + "/state"));
        send(put("/admin-api/publications/apis/" + apiView.at("/document/id").asText() + "/status")
                .content("{\"expectedStateVersion\":" + state.get("stateVersion").asText()
                        + ",\"enabled\":false,\"reason\":\"平台SDK独立验收\"}"));
        assertThat(mvc.perform(get("/public-api/sdk-assets/" + id + "/download").param("expectedRevision", "3"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).isEqualTo(zip);
        send(post("/admin-api/sdk-assets/" + id + "/withdraw").content("{\"expectedRevision\":3}"));
        mvc.perform(get("/public-api/sdk-assets/" + id + "/download").param("expectedRevision", "3"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/public-api/sdk-assets").param("sdkVersion", sdkVersion))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
    }

    @Test
    void verifiesStoredArchiveForPublishingAndEveryDownloadAndBoundsAnonymousQueries() throws Exception {
        String sdkVersion = "v-" + UUID.randomUUID().toString().substring(0, 20);
        String id = send(post("/admin-api/sdk-assets").content(platformDeclaration(sdkVersion).toString())).get("id").asText();
        byte[] zip = archive(sdkVersion);
        upload(id, 1, zip);
        byte[] invalid = "not a zip".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String invalidHash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(invalid));
        jdbc.update("UPDATE sdk_asset SET payload=?,size_bytes=?,sha256=? WHERE id=?", invalid, invalid.length, invalidHash, id);
        mvc.perform(auth(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":2}")))
                .andExpect(status().isInternalServerError());
        mvc.perform(auth(get("/admin-api/sdk-assets/" + id))).andExpect(jsonPath("$.data.status").value("DRAFT"))
                .andExpect(jsonPath("$.data.revision").value(2));
        upload(id, 2, zip);
        send(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":3}"));
        jdbc.update("UPDATE sdk_asset SET sha256=? WHERE id=?", "0".repeat(64), id);
        mvc.perform(get("/public-api/sdk-assets/" + id + "/download").param("expectedRevision", "4"))
                .andExpect(status().isInternalServerError()).andExpect(header().doesNotExist("Content-Disposition"));
        jdbc.update("UPDATE sdk_asset SET payload=? WHERE id=?", new byte[2 * 1024 * 1024 + 1], id);
        mvc.perform(auth(get("/admin-api/sdk-assets/" + id + "/download").param("expectedRevision", "4")))
                .andExpect(status().isInternalServerError());
        mvc.perform(get("/public-api/sdk-assets/" + id + "/download").param("expectedRevision", "99"))
                .andExpect(status().isNotFound());
        jdbc.update("UPDATE sdk_asset SET payload=NULL WHERE id=?", id);
        mvc.perform(get("/public-api/sdk-assets/" + id)).andExpect(status().isNotFound());
        mvc.perform(get("/public-api/sdk-assets").param("sdkVersion", sdkVersion))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(get("/public-api/sdk-assets").param("pageSize", "101")).andExpect(status().isBadRequest());
        mvc.perform(get("/public-api/sdk-assets").param("page", "100002").param("pageSize", "1")).andExpect(status().isBadRequest());
        mvc.perform(get("/public-api/sdk-assets").param("query", "x".repeat(101))).andExpect(status().isBadRequest());
        mvc.perform(get("/public-api/sdk-assets").param("sdkVersion", "x".repeat(33))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/sdk-assets").param("kind", "UNKNOWN"))).andExpect(status().isBadRequest());
    }

    @Test
    void sharesTransferCapacityBetweenPublishingAndAnonymousDownload() throws Exception {
        String sdkVersion = "c-" + UUID.randomUUID().toString().substring(0, 20);
        String id = send(post("/admin-api/sdk-assets").content(platformDeclaration(sdkVersion).toString())).get("id").asText();
        upload(id, 1, archive(sdkVersion));
        transfers.execute(() -> transfers.execute(() -> transfers.execute(() -> transfers.execute(() -> {
            try {
                mvc.perform(auth(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":2}")))
                        .andExpect(status().isTooManyRequests());
                mvc.perform(get("/public-api/sdk-assets/" + id + "/download").param("expectedRevision", "2"))
                        .andExpect(status().isTooManyRequests());
            } catch (Exception failure) { throw new AssertionError(failure); }
            return null;
        }))));
        send(post("/admin-api/sdk-assets/" + id + "/publish").content("{\"expectedRevision\":2}"));
        mvc.perform(get("/public-api/sdk-assets/" + id + "/download").param("expectedRevision", "3")).andExpect(status().isOk());
    }

    private ObjectNode platformDeclaration(String sdkVersion) {
        return json.createObjectNode().put("kind", "PLATFORM").put("name", "平台SDK")
                .put("sdkVersion", sdkVersion).put("language", "JAVA").put("gatewayProtocol", "HTTP_JSON_BEARER_V1")
                .put("runtime", "Java21+").put("releaseNotes", "公开源码与接入样例");
    }

    private JsonNode create(JsonNode view) throws Exception {
        return send(post("/admin-api/sdk-assets").content(json.createObjectNode()
                .put("apiId", view.at("/document/id").asText()).put("releaseId", view.get("releaseId").asText())
                .put("name", "订单SDK").put("sdkVersion", "1.0.0").put("language", "JAVA")
                .put("gatewayProtocol", "HTTP_JSON_BEARER_V1").put("runtime", "Java21+").put("releaseNotes", "首次发布").toString()));
    }

    private JsonNode upload(String id, long revision, byte[] content) throws Exception {
        var response = mvc.perform(auth(put("/admin-api/sdk-assets/" + id + "/content").param("expectedRevision", Long.toString(revision)))
                .contentType("application/zip").content(content)).andExpect(status().isOk()).andReturn().getResponse();
        return json.readTree(response.getContentAsString()).get("data");
    }

    private byte[] archive(String sdkVersion) throws Exception {
        var bytes = new java.io.ByteArrayOutputStream();
        try (var zip = new java.util.zip.ZipOutputStream(bytes)) {
            zip.putNextEntry(new java.util.zip.ZipEntry("sdk-manifest.json"));
            zip.write(json.createObjectNode().put("format", "cyl-openplatform.sdk/v1").put("sdkVersion", sdkVersion)
                    .put("language", "JAVA").put("gatewayProtocol", "HTTP_JSON_BEARER_V1").put("runtime", "Java21+")
                    .toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return bytes.toByteArray();
    }

    private String token(ObjectNode draft) throws Exception {
        JsonNode app = send(post("/admin-api/applications").content("{\"name\":\"SDK读者\",\"ownerTenantId\":\"101\"}"));
        send(put("/admin-api/applications/" + app.at("/application/id").asText() + "/scopes")
                .content(json.createObjectNode().set("scopeCodes", draft.get("scopeCodes")).toString()));
        ObjectNode credentials = json.createObjectNode().put("appKey", app.at("/application/appKey").asText())
                .put("appSecret", app.get("appSecret").asText()).put("tenantId", "101");
        send(post("/admin-api/tenant-grants").content(credentials.toString()));
        return json.readTree(mvc.perform(post("/api/token").contentType("application/json").content(credentials.toString()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).at("/data/accessToken").asText();
    }

    private JsonNode publish(ObjectNode draft) throws Exception {
        String scope = "doc_" + UUID.randomUUID().toString().replace("-", "");
        send(post("/admin-api/scopes").content("{\"code\":\"" + scope + "\",\"name\":\"文档权限\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        draft.putArray("scopeCodes").add(scope);
        String id = send(post("/admin-api/apis").content(draft.toString())).get("id").asText();
        JsonNode release = send(post("/admin-api/publications/apis/" + id + "/submissions").content(
                "{\"expectedDraftRevision\":1,\"expectedStateVersion\":0,\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"文档发布\"}"));
        send(post("/admin-api/publications/" + release.get("id").asText() + "/approve").content("{\"comment\":\"通过\"}"));
        return send(get("/admin-api/documents/" + operation(draft) + "/view"));
    }

    private String operation(ObjectNode draft) {
        return draft.get("service").asText() + "/" + draft.get("version").asText() + "/" + draft.get("method").asText();
    }

    private ObjectNode draft() {
        return (ObjectNode) json.readTree(definition("orders_" + UUID.randomUUID().toString().replace("-", "")));
    }

    private String definition(String service) {
        return """
                {"service":"%s","version":"v1","method":"query","name":"订单查询","category":"订单","owner":"研发",
                 "scopeCodes":[],
                 "requestSchema":{"type":"OBJECT","required":true,"properties":{"orderId":{"type":"STRING","required":true,"example":"order-001"}}},
                 "responseSchema":{"type":"OBJECT","properties":{"orderId":{"type":"STRING","example":"order-001"}}},
                 "errorDefinitions":[{"code":"ORDER_NOT_FOUND","message":"订单不存在"}],
                 "binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/orders/query","method":"POST"}},
                 "mappings":[{"target":"orderId","source":"REQUEST","path":"orderId"}]}
                """.formatted(service);
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016")
                .contentType("application/json");
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        var result = mvc.perform(auth(request)).andReturn();
        assertThat(result.getResponse().getStatus()).as("HTTP响应: %s; 异常: %s",
                result.getResponse().getContentAsString(), result.getResolvedException()).isEqualTo(200);
        return json.readTree(result.getResponse().getContentAsString()).get("data");
    }
}
