package io.github.chenyilei2016.openplatform.importing;


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
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
@SpringBootTest(properties = {

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=operator-1",
        "test.admin.operators[0].permissions[0]=MANAGE_APIS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=viewer",
        "test.admin.operators[1].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class ImportSourceHttpTest {
    private static final String PREVIEW = "/admin-api/api-imports/preview";
    @Autowired MockMvc mvc;
    @MockitoBean AccountAuthentication identityService;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void login() {
        TestAccount user = new TestAccount();
        user.setId(123L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    @Test
    void previewsNativeContractWithoutLosingDecimalPrecisionOrWriting() throws Exception {
        String source = source();
        var response = mvc.perform(auth(post(PREVIEW).content(source))).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store")).andReturn().getResponse().getContentAsString();
        assertThat(response).contains("1234567890.1234567890123456789");
        JsonNode preview = json.readTree(response).get("data");
        assertThat(preview.get("documentDigest").asText()).matches("[0-9a-f]{64}");
        assertThat(preview.at("/items/0/change").asText()).isEqualTo("CREATE");
        String service = json.readTree(source).get("service").asText();
        mvc.perform(auth(get("/admin-api/apis").param("query", service)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
    }

    @Test
    void reportsMalformedItemsAndDuplicateOperationsWithoutEchoingUnknownSourceFields() throws Exception {
        String valid = source();
        String unknown = valid.replace("\"name\":", "\"secretMarker\":\"never-echo-this\",\"name\":");
        String body = "{\"format\":\"cyl-openplatform.catalog/v1\",\"apis\":[" + valid + "," + valid + "," + unknown + ",null]}";
        String response = mvc.perform(auth(post(PREVIEW).content(body))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode items = json.readTree(response).at("/data/items");
        assertThat(items.size()).isEqualTo(4);
        for (JsonNode item : items) assertThat(item.get("change").asText()).isEqualTo("ERROR");
        assertThat(response).doesNotContain("never-echo-this");
        // 即使同操作的另一行因未知字段而无效，也不能猜测选择哪份契约。
        mvc.perform(auth(post(PREVIEW).content("{\"format\":\"cyl-openplatform.catalog/v1\",\"apis\":[" + valid + "," + unknown + "]}")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].change").value("ERROR"))
                .andExpect(jsonPath("$.data.items[1].change").value("ERROR"));
        for (String field : new String[]{"id", "draftRevision", "protocol", "expectedRevision"}) {
            String input = valid.replace("\"name\":", "\"" + field + "\":null,\"name\":");
            mvc.perform(auth(post(PREVIEW).content(input))).andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.items[0].change").value("ERROR"));
        }
    }

    @Test
    void rejectsInvalidEnvelopesDuplicateJsonTrailingContentAndOversizedInput() throws Exception {
        for (String body : new String[]{"[]", "{} {}", "{\"format\":1,\"format\":2}",
                "{\"format\":\"other\",\"apis\":[]}", "{\"format\":\"cyl-openplatform.catalog/v1\",\"apis\":[]}",
                "{\"format\":\"cyl-openplatform.catalog/v1\",\"apis\":[" + String.join(",", java.util.Collections.nCopies(21, "{}")) + "]}"}) {
            mvc.perform(auth(post(PREVIEW).content(body))).andExpect(status().isBadRequest());
        }
        mvc.perform(auth(post(PREVIEW).content(" ".repeat(262_145)))).andExpect(status().isPayloadTooLarge());
        mvc.perform(auth(post(PREVIEW).content("{}")).contentType("text/plain")).andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void requiresLoginPermissionAndCsrf() throws Exception {
        mvc.perform(post(PREVIEW).contentType("application/json").content(source())).andExpect(status().isUnauthorized());
        mvc.perform(post(PREVIEW).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).contentType("application/json").content(source()))
                .andExpect(status().isForbidden());
        TestAccount viewer = new TestAccount();
        viewer.setId(124L); viewer.setTenantId("tenant-1"); viewer.setEmployeeNoStr("viewer");
        when(identityService.current("test-session")).thenAnswer(invocation -> viewer.toAccount());
        mvc.perform(auth(post(PREVIEW).content(source()))).andExpect(status().isForbidden());
    }

    @Test
    void confirmationRejectsChangedSourceAndNonIntegerOrDuplicateSelections() throws Exception {
        String source = source();
        String response = mvc.perform(auth(post(PREVIEW).content(source))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String digest = json.readTree(response).at("/data/documentDigest").asText();
        for (String selection : new String[]{"{\"index\":0,\"expectedRevision\":0.0}", "{\"index\":0.0,\"expectedRevision\":0}",
                "{\"index\":\"0\",\"expectedRevision\":0}", "{\"index\":0,\"expectedRevision\":\"0\"}",
                "{\"index\":0,\"expectedRevision\":9223372036854775807}", "{\"index\":1,\"expectedRevision\":0}",
                "{\"index\":0,\"expectedRevision\":0},{\"index\":0,\"expectedRevision\":0}"}) {
            mvc.perform(auth(post("/admin-api/api-imports/confirm").content("{\"document\":" + source + ",\"documentDigest\":\"" + digest
                    + "\",\"selections\":[" + selection + "]}"))).andExpect(status().isBadRequest());
        }
        mvc.perform(auth(post("/admin-api/api-imports/confirm").content("{\"document\":" + source.replace("研发", "改变")
                + ",\"documentDigest\":\"" + digest + "\",\"selections\":[{\"index\":0,\"expectedRevision\":0}]}")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.data.committed").value(false))
                .andExpect(jsonPath("$.data.items[0].index").value(0));
    }

    private String source() {
        return """
                {"service":"import_%s","version":"v1","method":"query","name":"订单","category":"示例","owner":"研发","scopeCodes":[],
                 "requestSchema":{"type":"OBJECT"},"responseSchema":{"type":"NUMBER","example":1234567890.1234567890123456789},
                 "errorDefinitions":[],"binding":{"protocol":"HTTP","timeoutMillis":1000,"http":{"url":"http://127.0.0.1:8091/orders","method":"POST"}},"mappings":[]}
                """.formatted(UUID.randomUUID().toString().replace("-", ""));
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }
}
