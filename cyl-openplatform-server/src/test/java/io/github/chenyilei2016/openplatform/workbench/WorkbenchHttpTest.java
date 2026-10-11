package io.github.chenyilei2016.openplatform.workbench;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import io.github.chenyilei2016.openplatform.application.workbench.WorkbenchService;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiCatalogRepository;
import io.github.chenyilei2016.openplatform.domain.operations.OperationsMetricsRepository;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** 114 工作台聚合（B6）与全局搜索（B4）：权限裁剪、每类上限、输入限制、聚合查询有界。 */
@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {

    "test.admin.operators[0].tenant-id=tenant-1", "test.admin.operators[0].employee-no=operator-1",
    "test.admin.operators[0].permissions[0]=MANAGE_APIS", "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
    "test.admin.operators[0].permissions[2]=PUBLISH_APIS", "test.admin.operators[0].permissions[3]=REVIEW_APIS",
    "test.admin.operators[0].permissions[4]=VIEW_AUDIT",
    "test.admin.operators[1].tenant-id=tenant-1", "test.admin.operators[1].employee-no=auditor",
    "test.admin.operators[1].permissions[0]=VIEW_AUDIT",
    "test.admin.operators[2].tenant-id=tenant-1", "test.admin.operators[2].employee-no=editor",
    "test.admin.operators[2].permissions[0]=MANAGE_APIS",
    "test.admin.operators[3].tenant-id=tenant-1", "test.admin.operators[3].employee-no=connector",
    "test.admin.operators[3].permissions[0]=MANAGE_CONNECTIONS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@org.springframework.context.annotation.Import(io.github.chenyilei2016.openplatform.testing.CatalogReferenceFixture.class)
class WorkbenchHttpTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate database;
    @Autowired ConfigurableEnvironment environment;
    @MockitoSpyBean ApiCatalogRepository catalog;
    @MockitoSpyBean OperationsMetricsRepository metrics;
    @MockitoBean AccountAuthentication identity;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach void login() { identity("operator-1", 12L); }

    @AfterEach void resetConfig() { environment.getPropertySources().remove("workbench-test"); }

    @Test void workbenchReturnsOnlyPermittedBlocks() throws Exception {
        assertThat(mvc.perform(get("/admin-api/workbench")).andReturn().getResponse().getStatus()).isEqualTo(401);
        JsonNode all = send(get("/admin-api/workbench"));
        assertThat(all.get("pendingReviews").isObject()).isTrue();
        assertThat(all.get("myDrafts").isObject()).isTrue();
        assertThat(all.at("/traffic/requests").isNumber()).isTrue();
        assertThat(all.at("/alerts/firing").isNumber()).isTrue();

        identity("auditor", 13L);
        JsonNode audit = send(get("/admin-api/workbench"));
        assertThat(audit.get("pendingReviews").isNull()).isTrue();
        assertThat(audit.get("myDrafts").isNull()).isTrue();
        assertThat(audit.get("traffic").isObject()).isTrue();
        assertThat(audit.get("alerts").isObject()).isTrue();

        identity("connector", 14L);
        JsonNode none = send(get("/admin-api/workbench"));
        for (String block : List.of("pendingReviews", "myDrafts", "traffic", "alerts"))
            assertThat(none.get(block).isNull()).as(block).isTrue();
    }

    @Test void workbenchAggregatesWithBoundedQueries() throws Exception {
        // 当前管理员（tenant-1 / 人员 ID 12）的人员档案，作为 API 负责人。
        String me = "wb-" + UUID.randomUUID().toString().substring(0, 8);
        database.update("INSERT INTO access_employee_profile(id,tenant_id,employee_id,user_id,employee_no,display_name,last_seen_at)"
                + " VALUES(?,'tenant-1','12','12','operator-1','工作台测试',CURRENT_TIMESTAMP)", me);
        try {
            auditEnabled(true);
            List<String> mine = new ArrayList<>();
            for (int index = 0; index < 11; index++) mine.add(send(post("/admin-api/apis").content(draft(me).toString())).get("id").asText());
            String others = send(post("/admin-api/apis").content(draft("研发").toString())).get("id").asText();
            for (int index = 0; index < 6; index++) submit(mine.get(index));
            String key = UUID.randomUUID().toString();
            Instant minute = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MINUTES);
            database.update("INSERT INTO platform_call_minute(bucket_start,mode,api_key,application_key,requests,successes,client_errors,server_errors,auth_rejected,rate_limited,slow_calls,unattributed,duration_sum,max_duration) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    minute.getEpochSecond() / 60, "PRODUCTION", key, "", 200, 150, 30, 20, 0, 0, 0, 0, 2000, 30);
            Mockito.clearInvocations(catalog, metrics);

            JsonNode data = send(get("/admin-api/workbench"));
            assertThat(data.at("/pendingReviews/total").asLong()).isGreaterThanOrEqualTo(6);
            assertThat(data.at("/pendingReviews/items")).hasSize(WorkbenchService.PENDING_LIMIT);
            assertThat(data.at("/myDrafts/ownerId").asText()).isEqualTo(me);
            assertThat(data.at("/myDrafts/items")).hasSize(WorkbenchService.DRAFT_LIMIT);
            assertThat(data.at("/myDrafts/truncated").asBoolean()).isTrue();
            List<String> drafts = new ArrayList<>();
            data.at("/myDrafts/items").forEach(item -> drafts.add(item.get("id").asText()));
            assertThat(drafts).doesNotContain(others).isSubsetOf(mine);
            assertThat(data.at("/traffic/requests").asLong()).isGreaterThanOrEqualTo(200);
            assertThat(data.at("/traffic/failureRate").isString()).isTrue();
            assertThat(data.at("/alerts/firing").asLong()).isZero();
            // 每个区块固定一次有界读取：负责 API 一页最多扫描 DRAFT_SCAN_LIMIT 条，统计只做一次汇总。
            verify(catalog, times(1)).page(argThat(query -> query.pageSize() == WorkbenchService.DRAFT_SCAN_LIMIT),
                    argThat(filter -> me.equals(filter.ownerId())));
            verify(metrics, times(1)).summary(any(), any(), any(), isNull(), isNull());
            database.update("DELETE FROM platform_call_minute WHERE api_key=?", key);
        } finally {
            database.update("DELETE FROM access_employee_profile WHERE id=?", me);
        }
    }

    @Test void workbenchWithoutOwnerProfileHasEmptyDrafts() throws Exception {
        identity("editor", 99999L);
        JsonNode data = send(get("/admin-api/workbench"));
        assertThat(data.at("/myDrafts/ownerId").isNull()).isTrue();
        assertThat(data.at("/myDrafts/items")).isEmpty();
        assertThat(data.get("pendingReviews").isObject()).isTrue();
        assertThat(data.get("traffic").isNull()).isTrue();
    }

    @Test void searchGroupsAreLimitedAndFilteredByPermission() throws Exception {
        String token = "srch" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        for (int index = 0; index < 6; index++) {
            ObjectNode body = draft("研发");
            body.put("name", token + "接口" + index);
            send(post("/admin-api/apis").content(body.toString()));
        }
        ObjectNode exact = draft("研发");
        String service = exact.get("service").asText();
        send(post("/admin-api/apis").content(exact.toString()));
        String appKey = null, secret = null;
        for (int index = 0; index < 6; index++) {
            JsonNode created = send(post("/admin-api/applications").content(json.writeValueAsString(Map.of("name", token + "凭据" + index, "ownerTenantId", "tenant-1"))));
            appKey = created.at("/application/appKey").asText();
            secret = created.get("appSecret").asText();
        }
        String requestId = "req-" + token;
        Timestamp now = Timestamp.from(Instant.now());
        database.update("INSERT INTO platform_call_record(id,request_id,mode,client_ip,outcome,http_status,duration_millis,occurred_at) VALUES(?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), requestId, "PRODUCTION", "127.0.0.1", "FAILURE", 502, 3, now);
        List<Object[]> people = new ArrayList<>();
        for (int index = 0; index < 6; index++)
            people.add(new Object[]{token + "-p" + index, "tenant-" + index, "emp-" + token + index, "user-" + token + index, "E" + token + index, token + "人员" + index});
        database.batchUpdate("INSERT INTO access_employee_profile(id,tenant_id,employee_id,user_id,employee_no,display_name,last_seen_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)", people);

        JsonNode all = send(get("/admin-api/search").param("q", token));
        assertThat(all.get("apis")).hasSize(5);
        assertThat(all.get("credentials")).hasSize(5);
        assertThat(all.get("calls")).isEmpty();
        assertThat(all.get("people")).hasSize(5);
        assertThat(send(get("/admin-api/search").param("q", service + ".query")).get("apis")).hasSize(1);
        JsonNode byKey = send(get("/admin-api/search").param("q", appKey)).get("credentials");
        assertThat(byKey).hasSize(1);
        assertThat(byKey.at("/0/appKey").asText()).isEqualTo(appKey);
        JsonNode call = send(get("/admin-api/search").param("q", requestId)).get("calls");
        assertThat(call).hasSize(1);
        assertThat(call.at("/0/httpStatus").asInt()).isEqualTo(502);
        assertThat(send(get("/admin-api/search").param("q", "E" + token + "3")).get("people")).hasSize(1);
        String raw = mvc.perform(auth(get("/admin-api/search").param("q", token))).andReturn().getResponse().getContentAsString();
        assertThat(raw).doesNotContain(secret, "secretDigest", "appSecret");

        identity("auditor", 13L);
        JsonNode audit = send(get("/admin-api/search").param("q", token));
        assertThat(audit.get("apis").isNull()).isTrue();
        assertThat(audit.get("credentials").isNull()).isTrue();
        assertThat(audit.get("calls").isArray()).isTrue();
        assertThat(audit.get("people")).hasSize(5);
        identity("editor", 15L);
        JsonNode editor = send(get("/admin-api/search").param("q", token));
        assertThat(editor.get("apis")).hasSize(5);
        assertThat(editor.get("credentials").isNull()).isTrue();
        assertThat(editor.get("calls").isNull()).isTrue();
        assertThat(editor.get("people").isNull()).isTrue();
        identity("connector", 14L);
        JsonNode none = send(get("/admin-api/search").param("q", token));
        for (String group : List.of("apis", "credentials", "calls", "people"))
            assertThat(none.get(group).isNull()).as(group).isTrue();
    }

    @Test void searchRejectsInvalidInput() throws Exception {
        assertThat(status(get("/admin-api/search"))).isEqualTo(400);
        assertThat(status(get("/admin-api/search").param("q", ""))).isEqualTo(400);
        assertThat(status(get("/admin-api/search").param("q", "   "))).isEqualTo(400);
        assertThat(status(get("/admin-api/search").param("q", "x".repeat(101)))).isEqualTo(400);
        assertThat(status(get("/admin-api/search").param("q", "a\u0001b"))).isEqualTo(400);
        // 完整 Token 明文（与凭据列表同一判定）直接拒绝，不进入任何分组的查询。
        assertThat(status(get("/admin-api/search").param("q", "Bearer abc"))).isEqualTo(400);
        assertThat(status(get("/admin-api/search").param("q", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"))).isEqualTo(400);
        assertThat(status(get("/admin-api/search").param("q", "x".repeat(100)))).isEqualTo(200);
        // % 与 _ 按字面匹配，不能变成全量通配。
        assertThat(send(get("/admin-api/search").param("q", "%")).get("apis")).isEmpty();
    }

    private void auditEnabled(boolean enabled) {
        environment.getPropertySources().addFirst(new MapPropertySource("workbench-test", Map.of("open-platform.publish.audit.enabled", enabled)));
    }

    private void submit(String id) throws Exception {
        long stateVersion = send(get("/admin-api/publications/apis/" + id + "/state")).get("stateVersion").asLong();
        send(post("/admin-api/publications/apis/" + id + "/submissions").content(
                "{\"expectedDraftRevision\":1,\"expectedStateVersion\":" + stateVersion + ",\"submissionKey\":\"" + UUID.randomUUID() + "\",\"comment\":\"上线\"}"));
    }

    private ObjectNode draft(String owner) throws Exception {
        String code = "scope_" + UUID.randomUUID().toString().replace("-", "");
        send(post("/admin-api/scopes").content("{\"code\":\"" + code + "\",\"name\":\"工作台权限组\",\"enabled\":true,\"defaultForNewApplication\":false}"));
        return (ObjectNode) json.readTree("""
{"service":"wb_%s","version":"v1","method":"query","name":"工作台查询","category":"订单","owner":"%s","scopeCodes":["%s"],
"requestSchema":{"type":"OBJECT","properties":{"orderId":{"type":"STRING","example":"order-001"}}},
"responseSchema":{"type":"STRING","example":"ok"},"errorDefinitions":[],
"binding":{"protocol":"HTTP","timeoutMillis":3000,"http":{"url":"https://internal.example/orders/query","method":"POST"}},"mappings":[]}
""".formatted(UUID.randomUUID().toString().replace("-", ""), owner, code));
    }

    private void identity(String employeeNo, long userId) {
        var user = new TestAccount();
        user.setId(userId);
        user.setTenantId("tenant-1");
        user.setEmployeeNoStr(employeeNo);
        when(identity.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }

    private int status(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(auth(request)).andReturn().getResponse().getStatus();
    }

    private JsonNode send(MockHttpServletRequestBuilder request) throws Exception {
        var response = mvc.perform(auth(request)).andReturn().getResponse();
        assertThat(response.getStatus()).as("HTTP response: %s", response.getContentAsString()).isEqualTo(200);
        return json.readTree(response.getContentAsString()).get("data");
    }
}
