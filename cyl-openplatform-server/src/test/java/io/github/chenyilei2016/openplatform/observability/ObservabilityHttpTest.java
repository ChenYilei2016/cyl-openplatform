package io.github.chenyilei2016.openplatform.observability;


import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.UUID;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;
import io.github.chenyilei2016.openplatform.schedule.CallRecordCleanup;
import io.github.chenyilei2016.openplatform.application.observability.ObservationSettings;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {
        "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/administrator-schema.sql",
        "open-platform.observability.cleanup-enabled=false",

        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=auditor",
        "test.admin.operators[0].permissions[0]=VIEW_AUDIT",
        "test.admin.operators[0].permissions[1]=MANAGE_APPLICATIONS",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=author",
        "test.admin.operators[1].permissions[0]=MANAGE_APIS"
})
@AutoConfigureMockMvc(print = org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
class ObservabilityHttpTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate database;
    @Autowired CallRecordRepository records;
    @Autowired ObservationSettings properties;
    @MockitoBean AccountAuthentication identityService;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void login() { identity("auditor"); }

    @Test
    void recordsEarlyGatewayRejectionsWithoutRawInputsAndFiltersByRequestId() throws Exception {
        var response = mvc.perform(post("/api/oauth/do-not-log-this/v1/query")
                        .contentType("text/plain").header("Authorization", "Bearer secret-do-not-log")
                        .content("private-customer-body"))
                .andExpect(status().isUnsupportedMediaType()).andReturn().getResponse();
        String requestId = response.getHeader("X-Request-Id");
        String body = mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].httpStatus").value(415))
                .andExpect(jsonPath("$.data.items[0].mode").value("PRODUCTION"))
                .andExpect(jsonPath("$.data.items[0].outcome").value("FAILURE"))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("private-customer-body", "secret-do-not-log", "do-not-log-this");
        mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId).param("outcome", "SUCCESS")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
    }

    @Test
    void unifiedAuditProjectsRealManagementChangeWithoutCredentials() throws Exception {
        var created = mvc.perform(auth(post("/admin-api/applications")
                        .content("{\"name\":\"日志检索测试\",\"ownerTenantId\":\"101\"}")))
                .andExpect(status().isOk()).andReturn().getResponse();
        var data = json.readTree(created.getContentAsString()).get("data");
        String appId = data.at("/application/id").asText();
        String result = mvc.perform(auth(get("/admin-api/observability/audits").param("applicationId", appId)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].source").value("ACCESS"))
                .andExpect(jsonPath("$.data.items[0].operatorEmployeeNo").value("auditor"))
                .andReturn().getResponse().getContentAsString();
        assertThat(result).doesNotContain(data.get("appSecret").asText(), "secretDigest", "snapshot", "summary");
    }

    @Test
    void callsCombineExactRecordAndCallerWithMultiValueFiltersBeforePagination() throws Exception {
        String requestId = UUID.randomUUID().toString();
        String first = UUID.randomUUID().toString();
        String second = UUID.randomUUID().toString();
        java.sql.Timestamp now = java.sql.Timestamp.from(Instant.now());
        database.batchUpdate("INSERT INTO platform_call_record(id,request_id,mode,employee_no,operator_employee_no,tenant_id,client_ip,outcome,http_status,duration_millis,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                java.util.List.of(
                        new Object[]{first, requestId, "PRODUCTION", "E_24", "ADMIN_OTHER", "tenant-a", "127.0.0.1", "SUCCESS", 200, 1, now},
                        new Object[]{second, requestId, "DRAFT_DEBUG", "E_24", "ADMIN_OTHER", "tenant-a", "127.0.0.1", "FAILURE", 403, 1, now},
                        new Object[]{UUID.randomUUID().toString(), requestId, "PRODUCTION", "E_240", "E_24", "tenant-a", "127.0.0.1", "SUCCESS", 200, 1, now},
                        new Object[]{UUID.randomUUID().toString(), requestId, "PRODUCTION", "E_24", "ADMIN_OTHER", "tenant-b", "127.0.0.1", "SUCCESS", 200, 1, now}));
        String firstPage = mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId)
                        .param("employeeNo", "E_24").param("tenantId", "tenant-a")
                        .param("mode", "PRODUCTION", "DRAFT_DEBUG").param("outcome", "SUCCESS", "FAILURE").param("pageSize", "1")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.items.length()").value(1)).andReturn().getResponse().getContentAsString();
        String nextPage = mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId)
                        .param("employeeNo", "E_24").param("tenantId", "tenant-a")
                        .param("mode", "PRODUCTION", "DRAFT_DEBUG").param("outcome", "SUCCESS", "FAILURE")
                        .param("pageSize", "1").param("page", "2")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(2))
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(firstPage).at("/data/items/0/id").asText())
                .isNotEqualTo(json.readTree(nextPage).at("/data/items/0/id").asText());
        mvc.perform(auth(get("/admin-api/observability/calls").param("id", second).param("employeeNo", "E_24")
                        .param("mode", "DRAFT_DEBUG").param("outcome", "FAILURE")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].id").value(second));
        mvc.perform(auth(get("/admin-api/observability/calls").param("id", first.substring(0, 35))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(auth(get("/admin-api/observability/calls").param("id", second).param("employeeNo", "ADMIN_OTHER")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
    }

    @Test
    void listsCarryTenantAndPersonNamesAndFilterByDurationRange() throws Exception {
        String requestId = UUID.randomUUID().toString();
        String tenant = "names-" + UUID.randomUUID().toString().substring(0, 8);
        java.sql.Timestamp now = java.sql.Timestamp.from(Instant.now());
        java.sql.Timestamp earlier = java.sql.Timestamp.from(Instant.now().minusSeconds(3600));
        // 同工号两条档案取最近一次姓名；租户名取最近非空值。
        database.batchUpdate("INSERT INTO access_employee_profile(id,tenant_id,tenant_name,employee_id,user_id,employee_no,display_name,last_seen_at) VALUES(?,?,?,?,?,?,?,?)",
                java.util.List.of(
                        new Object[]{UUID.randomUUID().toString(), tenant, "旧租户名", "emp-old", "u-old", "E_N1", "旧姓名", earlier},
                        new Object[]{UUID.randomUUID().toString(), tenant, "测试租户", "emp-new", "u-new", "E_N1", "张三", now},
                        new Object[]{UUID.randomUUID().toString(), tenant, "测试租户", "emp-op", "u-op", "OP_N1", "李四", now}));
        database.batchUpdate("INSERT INTO platform_call_record(id,request_id,mode,employee_no,tenant_id,client_ip,outcome,http_status,duration_millis,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                java.util.List.of(
                        new Object[]{UUID.randomUUID().toString(), requestId, "PRODUCTION", "E_N1", tenant, "127.0.0.1", "SUCCESS", 200, 15, now},
                        new Object[]{UUID.randomUUID().toString(), requestId, "PRODUCTION", "E_UNKNOWN", tenant, "127.0.0.1", "FAILURE", 502, 1800, now},
                        new Object[]{UUID.randomUUID().toString(), requestId, "PRODUCTION", null, "tenant-without-profile", "127.0.0.1", "SUCCESS", 200, 40, now}));
        String body = mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(3))
                .andReturn().getResponse().getContentAsString();
        var items = json.readTree(body).at("/data/items");
        java.util.Map<String, tools.jackson.databind.JsonNode> byEmployee = new java.util.HashMap<>();
        items.forEach(item -> byEmployee.put(item.path("employeeNo").isNull() ? "none" : item.path("employeeNo").asText(), item));
        assertThat(byEmployee.get("E_N1").get("tenantName").asText()).isEqualTo("测试租户");
        assertThat(byEmployee.get("E_N1").get("employeeName").asText()).isEqualTo("张三");
        assertThat(byEmployee.get("E_N1").get("durationMillis").asLong()).isEqualTo(15);
        assertThat(byEmployee.get("E_UNKNOWN").get("employeeName").isNull()).isTrue();
        assertThat(byEmployee.get("none").get("tenantName").isNull()).isTrue();
        mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId)
                        .param("durationMin", "20").param("durationMax", "1800")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(2));
        mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId).param("durationMin", "1000")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].httpStatus").value(502));
        mvc.perform(auth(get("/admin-api/observability/calls").param("durationMin", "50").param("durationMax", "10")))
                .andExpect(status().isBadRequest());

        String auditId = UUID.randomUUID().toString();
        database.update("INSERT INTO catalog_audit(id,api_id,draft_revision,action,operator_tenant_id,operator_employee_no,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)",
                auditId, UUID.randomUUID().toString(), 1, "UPDATE_DRAFT", tenant, "OP_N1", requestId, now);
        database.update("INSERT INTO token_audit(id,action,actor_kind,operator_tenant_id,operator_employee_no,application_id,tenant_id,token_id,outcome,reason,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                auditId, "REVOKE", "ADMIN", tenant, "ADMIN_N1", UUID.randomUUID().toString(), tenant, UUID.randomUUID().toString(), "SUCCESS", "not-projected", requestId, now);
        database.update("INSERT INTO platform_administrator (id, tenant_id, user_id, employee_id, employee_no, display_name,"
                + " enabled, super_administrator, revision) VALUES (?, ?, '13', 'e-admin-n1', 'ADMIN_N1', '王管理', TRUE, FALSE, 1)", "admin-" + tenant, tenant);
        try {
            mvc.perform(auth(get("/admin-api/observability/audits").param("id", auditId).param("source", "CATALOG")))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].operatorName").value("李四"))
                    .andExpect(jsonPath("$.data.items[0].operatorEmployeeNo").value("OP_N1"));
            mvc.perform(auth(get("/admin-api/observability/audits").param("id", auditId).param("source", "TOKEN")))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].operatorName").value("王管理"))
                    .andExpect(jsonPath("$.data.items[0].tenantName").value("测试租户"));
        } finally {
            database.update("DELETE FROM platform_administrator WHERE id = ?", "admin-" + tenant);
        }
    }

    @Test
    void auditIdAndOperatorApplyToAllFourSourcesWithOrWithinAndAcrossFilters() throws Exception {
        String id = UUID.randomUUID().toString();
        String requestId = UUID.randomUUID().toString();
        String apiId = UUID.randomUUID().toString();
        java.sql.Timestamp now = java.sql.Timestamp.from(Instant.now());
        database.update("INSERT INTO access_audit(id,action,operator_tenant_id,operator_employee_no,target_id,outcome,summary,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
                id, "UPDATE_API_GOVERNANCE", "operator-tenant", "OP_24", apiId, "SUCCESS", "not-projected", requestId, now);
        database.update("INSERT INTO token_audit(id,action,actor_kind,operator_tenant_id,operator_employee_no,application_id,tenant_id,token_id,outcome,reason,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                id, "REVOKE", "ADMIN", "operator-tenant", "OP_24", UUID.randomUUID().toString(), "business-tenant", apiId, "FAILURE", "not-projected", requestId, now);
        database.update("INSERT INTO catalog_audit(id,api_id,draft_revision,action,operator_tenant_id,operator_employee_no,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)",
                id, apiId, 1, "UPDATE_DRAFT", "operator-tenant", "OP_24", requestId, now);
        database.update("INSERT INTO publication_audit(id,api_id,action,operator_tenant_id,operator_employee_no,outcome,summary,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
                id, apiId, "APPROVE", "operator-tenant", "OP_240", "SUCCESS", "not-projected", requestId, now);
        mvc.perform(auth(get("/admin-api/observability/audits").param("id", id).param("operatorEmployeeNo", "OP_24")
                        .param("source", "ACCESS", "TOKEN", "CATALOG", "PUBLICATION")
                        .param("outcome", "SUCCESS", "FAILURE").param("pageSize", "1").param("page", "2")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(3))
                .andExpect(jsonPath("$.data.items.length()").value(1))
                .andExpect(jsonPath("$.data.items[0].source").value("CATALOG"));
        mvc.perform(auth(get("/admin-api/observability/audits").param("id", id).param("operatorEmployeeNo", "OP_24")
                        .param("source", "TOKEN", "CATALOG").param("outcome", "FAILURE")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].source").value("TOKEN"));
        mvc.perform(auth(get("/admin-api/observability/audits").param("id", id).param("operatorEmployeeNo", "OP_24")
                        .param("tenantId", "operator-tenant")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(auth(get("/admin-api/observability/audits").param("id", id).param("operatorTenantId", "operator-tenant")
                        .param("targetId", apiId).param("source", "ACCESS", "TOKEN", "CATALOG", "PUBLICATION")
                        .param("outcome", "SUCCESS", "FAILURE")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(4));
        mvc.perform(auth(get("/admin-api/observability/audits").param("id", id).param("operatorTenantId", "operator")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(auth(get("/admin-api/observability/audits").param("id", id).param("targetId", apiId.substring(0, 35))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(auth(get("/admin-api/observability/audits").param("id", id.substring(0, 35))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
    }

    @Test
    void queryRequiresDedicatedPermissionAndRejectsUnboundedSearches() throws Exception {
        mvc.perform(get("/admin-api/observability/calls")).andExpect(status().isUnauthorized());
        for (String path : new String[]{"calls", "audits"}) {
            mvc.perform(auth(get("/admin-api/observability/" + path).param("pageSize", "101")))
                    .andExpect(status().isBadRequest());
            mvc.perform(auth(get("/admin-api/observability/" + path).param("page", "100001")))
                    .andExpect(status().isBadRequest());
            mvc.perform(auth(get("/admin-api/observability/" + path).param("from", "2026-01-01T00:00:00Z")
                            .param("to", "2026-03-01T00:00:00Z"))).andExpect(status().isBadRequest());
            mvc.perform(auth(get("/admin-api/observability/" + path).param("id", "x".repeat(37))))
                    .andExpect(status().isBadRequest());
            mvc.perform(auth(get("/admin-api/observability/" + path).param("outcome", "SUCCESS", "UNKNOWN")))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(auth(get("/admin-api/observability/calls").param("employeeNo", " "))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/observability/calls").param("mode", "PRODUCTION", "OTHER"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/observability/audits").param("operatorEmployeeNo", "x".repeat(65)))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/observability/audits").param("source", "ACCESS", "OTHER"))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/observability/audits").param("operatorTenantId", " "))).andExpect(status().isBadRequest());
        mvc.perform(auth(get("/admin-api/observability/audits").param("targetId", "x".repeat(65)))).andExpect(status().isBadRequest());
        identity("author");
        mvc.perform(auth(get("/admin-api/observability/calls"))).andExpect(status().isForbidden());
        mvc.perform(auth(get("/admin-api/observability/audits"))).andExpect(status().isForbidden());
    }

    @Test
    void projectsAllExistingAuditSourcesWithGovernanceApiAndBusinessActorIdentity() throws Exception {
        String requestId = UUID.randomUUID().toString();
        String apiId = UUID.randomUUID().toString();
        var now = java.sql.Timestamp.from(Instant.now());
        database.update("INSERT INTO access_audit(id,action,operator_tenant_id,operator_employee_no,target_id,outcome,summary,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), "UPDATE_API_GOVERNANCE", "tenant-1", "auditor", apiId, "SUCCESS", "secret-input-never-project", requestId, now);
        database.update("INSERT INTO token_audit(id,action,actor_kind,application_id,tenant_id,outcome,reason,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), "ISSUE", "APPLICATION_CREDENTIALS", UUID.randomUUID().toString(), "202", "FAILURE", "secret-input-never-project", requestId, now);
        database.update("INSERT INTO catalog_audit(id,api_id,draft_revision,action,operator_tenant_id,operator_employee_no,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), apiId, 7, "UPDATE_DRAFT", "tenant-1", "auditor", requestId, now);
        database.update("INSERT INTO publication_audit(id,api_id,release_id,action,operator_tenant_id,operator_employee_no,outcome,summary,request_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), apiId, UUID.randomUUID().toString(), "APPROVE", "tenant-1", "auditor", "SUCCESS", "secret-input-never-project", requestId, now);
        var response = mvc.perform(auth(get("/admin-api/observability/audits").param("requestId", requestId)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(4))
                .andReturn().getResponse().getContentAsString();
        assertThat(response).contains("APPLICATION_CREDENTIALS", "CATALOG", "PUBLICATION", "ACCESS")
                .doesNotContain("secret-input-never-project");
        mvc.perform(auth(get("/admin-api/observability/audits").param("requestId", requestId).param("apiId", apiId)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(3));
        mvc.perform(auth(get("/admin-api/observability/audits").param("requestId", requestId).param("source", "CATALOG")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].draftRevision").value(7));
        mvc.perform(auth(get("/admin-api/observability/audits").param("requestId", requestId).param("outcome", "FAILURE").param("tenantId", "202")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].operatorEmployeeNo").isEmpty());
    }

    @Test
    void cleanupDeletesAtMostOneBoundedBatchAndPreservesRecentCallsAndAudits() throws Exception {
        String requestId = UUID.randomUUID().toString();
        var expired = java.sql.Timestamp.from(Instant.now().minus(40, ChronoUnit.DAYS));
        var inputs = new ArrayList<Object[]>();
        for (int i = 0; i < 1001; i++) inputs.add(new Object[]{UUID.randomUUID().toString(), requestId, "PRODUCTION", "127.0.0.1", "SUCCESS", 200, 1, expired});
        inputs.add(new Object[]{UUID.randomUUID().toString(), requestId, "DRAFT_DEBUG", "127.0.0.1", "SUCCESS", 200, 1, java.sql.Timestamp.from(Instant.now())});
        database.batchUpdate("INSERT INTO platform_call_record(id,request_id,mode,client_ip,outcome,http_status,duration_millis,occurred_at) VALUES(?,?,?,?,?,?,?,?)", inputs);
        String from = Instant.now().minus(41, ChronoUnit.DAYS).toString();
        String to = Instant.now().minus(39, ChronoUnit.DAYS).toString();
        long auditCount = json.readTree(mvc.perform(auth(get("/admin-api/observability/audits")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).at("/data/total").asLong();
        new CallRecordCleanup(records, properties).cleanExpired();
        mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId).param("from", from).param("to", to)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(auth(get("/admin-api/observability/audits")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(auditCount));
        new CallRecordCleanup(records, properties).cleanExpired();
        mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId).param("from", from).param("to", to)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(auth(get("/admin-api/observability/calls").param("requestId", requestId)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].mode").value("DRAFT_DEBUG"));
    }

    private void identity(String employeeNo) {
        TestAccount user = new TestAccount();
        user.setId(99L); user.setTenantId("tenant-1"); user.setEmployeeNoStr(employeeNo);
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }

    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }
}
