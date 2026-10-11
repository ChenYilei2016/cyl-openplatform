package io.github.chenyilei2016.openplatform.operations;


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
import tools.jackson.databind.json.JsonMapper;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {
    "spring.sql.init.schema-locations=classpath:db/access-schema.sql,classpath:db/mcp-schema.sql,classpath:db/catalog-schema.sql,classpath:db/dubbo-connection-schema.sql,classpath:db/token-schema.sql,classpath:db/publication-schema.sql,classpath:db/governance-schema.sql,classpath:db/observability-schema.sql,classpath:db/operations-metrics-schema.sql,classpath:db/operations-alert-schema.sql",
    "open-platform.operations.alerts.evaluation-enabled=false", "open-platform.operations.cleanup-enabled=false",

    "test.admin.operators[0].tenant-id=tenant-1", "test.admin.operators[0].employee-no=operator",
    "test.admin.operators[0].permissions[0]=VIEW_AUDIT", "test.admin.operators[0].permissions[1]=MANAGE_OPERATIONS",
    "test.admin.operators[1].tenant-id=tenant-1", "test.admin.operators[1].employee-no=reader",
    "test.admin.operators[1].permissions[0]=VIEW_AUDIT"
})
@AutoConfigureMockMvc(print = org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
class OperationsAlertHttpTest {
    @Autowired MockMvc mvc;
    @Autowired org.springframework.jdbc.core.JdbcTemplate database;
    @Autowired io.github.chenyilei2016.openplatform.domain.operations.OperationsAlertRepository alerts;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    io.github.chenyilei2016.openplatform.domain.operations.OperationsMetricsRepository metrics;
    @MockitoBean AccountAuthentication identity;
    private final JsonMapper json = JsonMapper.builder().build();
    @BeforeEach void login() { identity("operator"); }

    @Test void policyEnforcesPermissionStrictNumbersAndCompareAndSet() throws Exception {
        mvc.perform(get("/admin-api/operations/alerts/policy")).andExpect(status().isUnauthorized());
        long version = json.readTree(mvc.perform(auth(get("/admin-api/operations/alerts/policy")))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andReturn().getResponse().getContentAsString()).at("/data/version").asLong();
        String body = policy(version, false);
        mvc.perform(put("/admin-api/operations/alerts/policy").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session"))
                .contentType("application/json").content(body)).andExpect(status().isForbidden());
        mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(body.replace("\"minRequests\":100", "\"minRequests\":\"100\"")))
            .andExpect(status().isBadRequest());
        mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(body.replace("\"failureRateThreshold\":5", "\"failureRateThreshold\":5.001")))
            .andExpect(status().isBadRequest());
        mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(body)).andExpect(status().isOk());
        mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(body)).andExpect(status().isConflict());
        identity("reader");
        mvc.perform(auth(get("/admin-api/operations/alerts/state"))).andExpect(status().isOk());
        mvc.perform(auth(post("/admin-api/operations/alerts/evaluate"))).andExpect(status().isForbidden());
        mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(policy(version + 1, false))).andExpect(status().isForbidden());
    }

    @Test void evaluationIsWindowIdempotentAndDisabledDoesNotBecomeNoData() throws Exception {
        long version = json.readTree(mvc.perform(auth(get("/admin-api/operations/alerts/policy")))
            .andReturn().getResponse().getContentAsString()).at("/data/version").asLong();
        mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(policy(version, false))).andExpect(status().isOk());
        org.mockito.Mockito.clearInvocations(metrics);
        mvc.perform(auth(post("/admin-api/operations/alerts/evaluate")).content("{}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.stale").value(false))
            .andExpect(jsonPath("$.data.states[0].status").value("DISABLED"));
        org.mockito.Mockito.verifyNoInteractions(metrics);
        long count = json.readTree(mvc.perform(auth(get("/admin-api/operations/alerts/events")))
            .andReturn().getResponse().getContentAsString()).at("/data/total").asLong();
        mvc.perform(auth(post("/admin-api/operations/alerts/evaluate"))).andExpect(status().isOk());
        mvc.perform(auth(get("/admin-api/operations/alerts/events"))).andExpect(jsonPath("$.data.total").value(count));
        mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(policy(version + 1, true))).andExpect(status().isOk());
        mvc.perform(auth(get("/admin-api/operations/alerts/state"))).andExpect(jsonPath("$.data.stale").value(true));
        mvc.perform(auth(post("/admin-api/operations/alerts/evaluate"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.states[0].status").value("NO_DATA"));
        mvc.perform(auth(get("/admin-api/operations/alerts/events").param("pageSize", "101"))).andExpect(status().isBadRequest());
        mvc.perform(auth(post("/admin-api/operations/alerts/evaluate")).content("{\"unexpected\":true}"))
            .andExpect(status().isBadRequest());
    }
    @Test void thresholdsUseUnroundedMetricsAndFailureDoesNotAdvanceLastEvaluation() throws Exception {
        var end = alerts.currentTime().minusSeconds(60).truncatedTo(java.time.temporal.ChronoUnit.MINUTES);
        String key = java.util.UUID.randomUUID().toString();
        database.update("INSERT INTO platform_call_minute(bucket_start,mode,api_key,application_key,requests,successes,client_errors,server_errors,auth_rejected,rate_limited,slow_calls,unattributed,duration_sum,max_duration) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                end.minusSeconds(60).getEpochSecond() / 60, "PRODUCTION", key, "", 100000, 95001, 0, 4999, 0, 0, 0, 0, 99999999, 1000);
        try {
            long version = alerts.policy(false).version();
            String body = policy(version, true).replace("\"latencyEnabled\":false", "\"latencyEnabled\":true");
            mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(body)).andExpect(status().isOk());
            mvc.perform(auth(post("/admin-api/operations/alerts/evaluate"))).andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.states[0].status").value("NORMAL"))
                    .andExpect(jsonPath("$.data.states[0].value").value("5.00"))
                    .andExpect(jsonPath("$.data.states[1].status").value("NORMAL"))
                    .andExpect(jsonPath("$.data.states[1].value").value("1000.00"));
            database.update("UPDATE platform_call_minute SET successes=95000,duration_sum=100000000 WHERE api_key=?", key);
            mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(body.replace("\"expectedVersion\":" + version, "\"expectedVersion\":" + (version + 1))))
                    .andExpect(status().isOk());
            mvc.perform(auth(post("/admin-api/operations/alerts/evaluate"))).andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.states[0].status").value("FIRING"))
                    .andExpect(jsonPath("$.data.states[1].status").value("FIRING"));
            database.update("UPDATE platform_alert_state SET evaluated_at=?", java.sql.Timestamp.from(end.minusSeconds(300)));
            mvc.perform(auth(put("/admin-api/operations/alerts/policy")).content(body.replace("\"expectedVersion\":" + version, "\"expectedVersion\":" + (version + 2))))
                    .andExpect(status().isOk());
            org.mockito.Mockito.doThrow(new io.github.chenyilei2016.openplatform.domain.common.PlatformException(
                    io.github.chenyilei2016.openplatform.domain.common.ErrorCode.DEPENDENCY_UNAVAILABLE, "聚合暂不可用"))
                    .when(metrics).summary(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                    org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull());
            mvc.perform(auth(post("/admin-api/operations/alerts/evaluate"))).andExpect(status().isServiceUnavailable());
            mvc.perform(auth(get("/admin-api/operations/alerts/state"))).andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.stale").value(true)).andExpect(jsonPath("$.data.states[0].status").value("FIRING"))
                    .andExpect(jsonPath("$.data.states[0].policyVersion").value(version + 2));
        } finally {
            org.mockito.Mockito.reset(metrics);
            database.update("DELETE FROM platform_call_minute WHERE api_key=?", key);
        }
    }

    @Test void eventRetentionDeletesOnlyOneBoundedBatch() {
        var expired = java.sql.Timestamp.from(java.time.Instant.now().minus(100, java.time.temporal.ChronoUnit.DAYS));
        var rows = new java.util.ArrayList<Object[]>();
        for (int index = 0; index < 1001; index++) rows.add(new Object[]{java.util.UUID.randomUUID().toString(), "FAILURE_RATE", "FIRING", 100000 + index, expired, expired, expired});
        database.batchUpdate("INSERT INTO platform_alert_event(id,metric,status,policy_version,occurred_at,window_start,window_end,sample_count) VALUES(?,?,?,?,?,?,?,100)", rows);
        var before = java.time.Instant.now().minus(90, java.time.temporal.ChronoUnit.DAYS);
        org.assertj.core.api.Assertions.assertThat(alerts.deleteExpired(before, 1000)).isEqualTo(1000);
        org.assertj.core.api.Assertions.assertThat(alerts.deleteExpired(before, 1000)).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(alerts.deleteExpired(before, 1000)).isZero();
    }

    private String policy(long version, boolean enabled) {
        return "{\"expectedVersion\":" + version + ",\"windowMinutes\":5,\"minRequests\":100,\"failureEnabled\":" + enabled
            + ",\"failureRateThreshold\":5,\"latencyEnabled\":false,\"averageLatencyThresholdMillis\":1000}";
    }
    private void identity(String employee) {
        var user = new TestAccount(); user.setId(99L); user.setTenantId("tenant-1"); user.setEmployeeNoStr(employee);
        when(identity.current("test-session")).thenAnswer(invocation -> user.toAccount());
    }
    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }
}
