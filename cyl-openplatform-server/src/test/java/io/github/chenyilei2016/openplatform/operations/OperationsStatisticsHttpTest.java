package io.github.chenyilei2016.openplatform.operations;

import io.github.chenyilei2016.openplatform.domain.observability.CallMode;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceDecision;
import io.github.chenyilei2016.openplatform.domain.governance.GovernanceRule;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecord;
import io.github.chenyilei2016.openplatform.domain.observability.CallRecordRepository;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {

        "open-platform.operations.alerts.evaluation-enabled=false",
        "test.admin.operators[0].tenant-id=tenant-1",
        "test.admin.operators[0].employee-no=viewer",
        "test.admin.operators[0].permissions[0]=VIEW_AUDIT",
        "test.admin.operators[1].tenant-id=tenant-1",
        "test.admin.operators[1].employee-no=editor",
        "test.admin.operators[1].permissions[0]=MANAGE_APIS"
})
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class OperationsStatisticsHttpTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired CallRecordRepository records;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    io.github.chenyilei2016.openplatform.domain.operations.OperationsMetricsRepository metrics;
    @MockitoBean AccountAuthentication identity;
    private final JsonMapper json = JsonMapper.builder().build();
    private static final Instant FROM = Instant.parse("2026-09-10T10:00:00Z");

    @BeforeEach
    void identity() {
        for (String employee : List.of("viewer", "editor")) {
            var user = new TestAccount(); user.setId(1L); user.setTenantId("tenant-1"); user.setEmployeeNoStr(employee);
            when(identity.current(employee)).thenAnswer(invocation -> user.toAccount());
        }
    }

    @Test
    void aggregatesPersistedRecordsWithPreciseDimensionsModesAndZeroBuckets() throws Exception {
        String api = UUID.randomUUID().toString(), app = UUID.randomUUID().toString();
        records.append(record(api, app, CallMode.PRODUCTION, 200, 80, FROM.plusSeconds(10)));
        records.append(record(api, app, CallMode.PRODUCTION, 429, 1000, FROM.plusSeconds(70)));
        records.append(record(api, app, CallMode.PRODUCTION, 503, 1920, FROM.plusSeconds(20)));
        records.append(record(api, "other", CallMode.PRODUCTION, 200, 1, FROM.plusSeconds(20)));
        records.append(record(api, app, CallMode.DRAFT_DEBUG, 200, 5, FROM.plusSeconds(10)));
        JsonNode result = read(query().param("apiId", api).param("applicationId", app).param("bucket", "MINUTE"));
        JsonNode totals = result.get("summary");
        assertThat(totals.get("requests").asLong()).isEqualTo(3);
        assertThat(totals.get("successRate").asText()).isEqualTo("33.33");
        assertThat(totals.get("averageLatencyMillis").asText()).isEqualTo("1000.00");
        assertThat(totals.get("slowCalls").asLong()).isEqualTo(2);
        assertThat(totals.get("clientErrors").asLong()).isEqualTo(1);
        assertThat(totals.get("serverErrors").asLong()).isEqualTo(1);
        assertThat(totals.get("rateLimited").asLong()).isEqualTo(1);
        assertThat(totals.get("maxDuration").asLong()).isEqualTo(1920);
        assertThat(result.get("points").size()).isEqualTo(5);
        assertThat(result.at("/points/2/totals/requests").asLong()).isZero();
        assertThat(result.at("/points/2/totals/successRate").isNull()).isTrue();
        assertThat(read(query().param("apiId", api).param("mode", "DRAFT_DEBUG")).at("/summary/requests").asLong()).isEqualTo(1);
        assertThat(read(query().param("apiId", api).with(request -> { request.setParameter("from", "2026-09-10T18:00:00+08:00");
                    request.setParameter("to", "2026-09-10T18:05:00+08:00"); return request; })).get("from").asText()).isEqualTo(FROM.toString());
    }

    @Test
    void lateRecordsUseOriginalMinuteAndDuplicatesNeverIncrementTwice() throws Exception {
        String app = UUID.randomUUID().toString();
        var late = record(null, app, CallMode.PRODUCTION, 401, 3, FROM.plusSeconds(1));
        records.append(late);
        assertThatThrownBy(() -> records.append(late)).isInstanceOf(RuntimeException.class);
        JsonNode result = read(query().param("applicationId", app).param("bucket", "MINUTE"));
        assertThat(result.at("/summary/requests").asLong()).isEqualTo(1);
        assertThat(result.at("/summary/unattributed").asLong()).isEqualTo(1);
        assertThat(result.at("/summary/authRejected").asLong()).isEqualTo(1);
        assertThat(result.at("/points/0/totals/requests").asLong()).isEqualTo(1);
    }

    @Test
    void businessFailureWithHttp200CountsAsFailureAndKeepsTrustedEmployeeId() throws Exception {
        String api = UUID.randomUUID().toString(), app = UUID.randomUUID().toString();
        CallRecord failed = CallRecord.builder().id(UUID.randomUUID().toString()).requestId(UUID.randomUUID().toString())
                .mode(CallMode.PRODUCTION).apiId(api).applicationId(app).tenantId("tenant-1")
                .userId("account-1").employeeId("employee-1").employeeNo("E1001")
                .clientIp("127.0.0.1").outcome("FAILURE").errorCode(50200002).httpStatus(200)
                .durationMillis(10).occurredAt(FROM.plusSeconds(1)).build();
        records.append(failed);
        JsonNode summary = read(query().param("apiId", api).param("applicationId", app)).path("summary");
        assertThat(summary.path("requests").asLong()).isEqualTo(1);
        assertThat(summary.path("successes").asLong()).isZero();
        assertThat(summary.path("successRate").asText()).isEqualTo("0.00");
        JsonNode detail = read(get("/admin-api/observability/calls").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer"))
                .param("id", failed.id()).param("from", FROM.toString()).param("to", FROM.plusSeconds(300).toString()));
        assertThat(detail.at("/items/0/employeeId").asText()).isEqualTo("employee-1");
    }

    @Test
    void ranksTrustedPeopleAndDeduplicatesRequestsWhileRuleEvaluationKeepsItsDenominator() throws Exception {
        String api = UUID.randomUUID().toString(), app = UUID.randomUUID().toString();
        GovernanceDecision decision = new GovernanceDecision(
                false, GovernanceDecision.Reason.TOKEN_BUCKET_LIMIT, 1,
                List.of(new GovernanceDecision.Hit("rule-a", 1,
                        GovernanceRule.Type.API,
                        GovernanceRule.Mode.ENFORCE,
                        GovernanceRule.Algorithm.TOKEN_BUCKET,
                        GovernanceDecision.Reason.TOKEN_BUCKET_LIMIT, 1),
                        new GovernanceDecision.Hit("rule-b", 2,
                        GovernanceRule.Type.TENANT,
                        GovernanceRule.Mode.OBSERVE,
                        GovernanceRule.Algorithm.TOKEN_BUCKET,
                        GovernanceDecision.Reason.DAILY_QUOTA, 1)));
        for (String tenant : List.of("rank-tenant-a", "rank-tenant-b")) {
            records.append(CallRecord.builder().id(UUID.randomUUID().toString()).requestId(UUID.randomUUID().toString())
                    .mode(CallMode.PRODUCTION).apiId(api).applicationId(app).tenantId(tenant).userId("account-same")
                    .employeeId("employee-same").employeeNo("E1001").clientIp("127.0.0.1")
                    .outcome("FAILURE").httpStatus(429).durationMillis(10).occurredAt(FROM).governance(decision).build());
        }
        records.append(CallRecord.builder().id(UUID.randomUUID().toString()).requestId(UUID.randomUUID().toString())
                .mode(CallMode.PRODUCTION).apiId(api).applicationId(app).tenantId("rank-tenant-a")
                .clientIp("127.0.0.1").outcome("SUCCESS").httpStatus(200).durationMillis(5).occurredAt(FROM)
                .governance(new GovernanceDecision(true,
                        GovernanceDecision.Reason.NONE, 0,
                        List.of(new GovernanceDecision.Hit("rule-a", 1,
                                GovernanceRule.Type.API,
                                GovernanceRule.Mode.ENFORCE,
                                GovernanceRule.Algorithm.TOKEN_BUCKET,
                                GovernanceDecision.Reason.NONE, 0)))).build());
        JsonNode all = read(query().param("apiId", api).param("dimension", "PERSON"));
        assertThat(all.at("/summary/requests").asLong()).isEqualTo(3);
        assertThat(all.at("/summary/governanceRejected").asLong()).isEqualTo(2);
        assertThat(all.at("/summary/observedRequests").asLong()).isEqualTo(2);
        assertThat(all.at("/summary/ruleHits").asLong()).isEqualTo(4);
        assertThat(all.path("rankings").size()).isEqualTo(3);
        assertThat(read(query().param("apiId", api).param("tenantId", "rank-tenant-a")
                .param("employeeId", "employee-same")).at("/summary/requests").asLong()).isEqualTo(1);
        JsonNode rule = read(query().param("apiId", api).param("ruleId", "rule-a").param("ruleVersion", "1"));
        assertThat(rule.at("/summary/requests").asLong()).isEqualTo(3);
        assertThat(rule.at("/summary/governanceRejected").asLong()).isEqualTo(2);
        assertThat(rule.at("/summary/observedRequests").asLong()).isZero();
        JsonNode affected = read(query().param("apiId", api).param("ruleId", "rule-a").param("ruleVersion", "1")
                .param("dimension", "PERSON").param("sort", "RULE_HITS"));
        assertThat(affected.at("/summary/requests").asLong()).isEqualTo(3);
        assertThat(affected.path("rankings").size()).isEqualTo(2);
        JsonNode observed = read(query().param("apiId", api).param("ruleId", "rule-b").param("ruleVersion", "2")
                .param("dimension", "PERSON").param("sort", "RULE_HITS"));
        assertThat(observed.at("/summary/governanceRejected").asLong()).isZero();
        assertThat(observed.at("/summary/observedRequests").asLong()).isEqualTo(2);
        assertThat(observed.path("rankings").size()).isEqualTo(2);
        JsonNode details = read(get("/admin-api/observability/calls").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer"))
                .param("from", FROM.toString()).param("to", FROM.plusSeconds(300).toString())
                .param("apiId", api).param("tenantId", "rank-tenant-a").param("employeeId", "employee-same")
                .param("ruleId", "rule-b").param("ruleVersion", "2").param("governanceOutcome", "OBSERVED"));
        assertThat(details.path("total").asLong()).isEqualTo(1);
        JsonNode cause = read(get("/admin-api/observability/calls").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer"))
                .param("from", FROM.toString()).param("to", FROM.plusSeconds(300).toString())
                .param("apiId", api).param("denialReason", "TOKEN_BUCKET_LIMIT"));
        assertThat(cause.path("total").asLong()).isEqualTo(2);
        assertThat(read(get("/admin-api/observability/calls").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer"))
                .param("from", FROM.toString()).param("to", FROM.plusSeconds(300).toString())
                .param("apiId", api).param("denialReason", "DAILY_QUOTA")).path("total").asLong()).isZero();
    }

    @Test
    void ruleDenialDrillUsesItsEvaluatedReasonWhileGlobalDrillUsesPrimaryDenial() throws Exception {
        String api = UUID.randomUUID().toString();
        records.append(CallRecord.builder().id(UUID.randomUUID().toString()).requestId(UUID.randomUUID().toString())
                .mode(CallMode.PRODUCTION).apiId(api).clientIp("127.0.0.1").outcome("FAILURE").httpStatus(403)
                .durationMillis(1).occurredAt(FROM).governance(new GovernanceDecision(false, GovernanceDecision.Reason.IP_DENIED, 0,
                        List.of(new GovernanceDecision.Hit("mixed-ip", 1, GovernanceRule.Type.API, GovernanceRule.Mode.ENFORCE,
                                GovernanceRule.Algorithm.TOKEN_BUCKET, GovernanceDecision.Reason.IP_DENIED, 0),
                                new GovernanceDecision.Hit("mixed-quota", 2, GovernanceRule.Type.TENANT, GovernanceRule.Mode.ENFORCE,
                                        GovernanceRule.Algorithm.TOKEN_BUCKET, GovernanceDecision.Reason.DAILY_QUOTA, 0)))).build());
        assertThat(read(query().param("apiId", api).param("ruleId", "mixed-quota").param("ruleVersion", "2"))
                .at("/summary/dailyQuotaRejected").asLong()).isEqualTo(1);
        MockHttpServletRequestBuilder detail = get("/admin-api/observability/calls").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer"))
                .param("from", FROM.toString()).param("to", FROM.plusSeconds(300).toString())
                .param("apiId", api).param("denialReason", "DAILY_QUOTA");
        assertThat(read(detail).path("total").asLong()).isZero();
        assertThat(read(detail.param("ruleId", "mixed-quota").param("ruleVersion", "2")).path("total").asLong()).isEqualTo(1);
    }

    @Test
    void aggregationFailureRollsBackRecordAndDoesNotPartiallyIncrement() {
        String api = UUID.randomUUID().toString();
        var first = record(api, null, CallMode.PRODUCTION, 200, 1, FROM);
        records.append(first);
        jdbc.update("UPDATE platform_call_minute SET requests=? WHERE api_key=?", Long.MAX_VALUE, api);
        var overflow = record(api, null, CallMode.PRODUCTION, 200, 1, FROM);
        try {
            assertThatThrownBy(() -> records.append(overflow)).isInstanceOf(RuntimeException.class);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM platform_call_record WHERE id=?", Long.class, overflow.id())).isZero();
            assertThat(jdbc.queryForObject("SELECT successes FROM platform_call_minute WHERE api_key=?", Long.class, api)).isEqualTo(1);
        } finally {
            jdbc.update("DELETE FROM platform_call_minute WHERE api_key=?", api);
        }
    }

    @Test
    void requiresAuditPermissionAndRejectsUnboundedOrUnalignedWindows() throws Exception {
        mvc.perform(get("/admin-api/operations/statistics")).andExpect(status().isUnauthorized());
        mvc.perform(get("/admin-api/operations/statistics").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("editor"))
                .param("from", FROM.toString()).param("to", FROM.plusSeconds(300).toString()))
                .andExpect(status().isForbidden());
        for (String[] invalid : List.of(new String[]{"from", "2026-09-10T10:00:01Z"},
                new String[]{"to", "2026-09-10T10:00:00Z"}, new String[]{"to", "2026-10-12T10:00:00Z"},
                new String[]{"to", "2026-09-20T10:00:00Z"}, new String[]{"apiId", "x".repeat(37)},
                new String[]{"mode", "UNKNOWN"}, new String[]{"from", "2026-09-10T10:00:00"})) {
            mvc.perform(query().with(request -> { request.setParameter(invalid[0], invalid[1]); return request; })).andExpect(status().isBadRequest());
        }
        mvc.perform(query()).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void boundsConcurrentStatisticsAndReleasesSlotsAfterQueriesComplete() throws Exception {
        String api = UUID.randomUUID().toString();
        var entered = new java.util.concurrent.CountDownLatch(4);
        var release = new java.util.concurrent.CountDownLatch(1);
        org.mockito.Mockito.doAnswer(call -> {
            entered.countDown();
            if (!release.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("查询未释放");
            return io.github.chenyilei2016.openplatform.domain.operations.OperationsTotals.empty();
        }).when(metrics).summary(FROM, FROM.plusSeconds(300), CallMode.PRODUCTION, api, null);
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(4)) {
            var requests = new java.util.ArrayList<java.util.concurrent.Future<Integer>>();
            try {
                for (int index = 0; index < 4; index++) {
                    requests.add(executor.submit(() -> mvc.perform(query().param("apiId", api)).andReturn().getResponse().getStatus()));
                }
                assertThat(entered.await(3, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                mvc.perform(query().param("apiId", api)).andExpect(status().isTooManyRequests());
            } finally { release.countDown(); }
            for (var request : requests) assertThat(request.get(5, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(200);
        }
        mvc.perform(query().param("apiId", api)).andExpect(status().isOk());
    }

    @Test
    void auditPermissionSelectsBoundedSafeTargetsWithoutManagementPermission() throws Exception {
        String id = io.github.chenyilei2016.openplatform.domain.common.ObjectIdType.APPLICATION.nextId();
        String appKey = UUID.randomUUID().toString().replace("-", "");
        jdbc.update("INSERT INTO access_application(id,app_key,name,owner_tenant_id,status,authorization_version,secret_digest) VALUES(?,?,?,?,?,?,?)",
                id, appKey, "85统计对象凭据", "tenant-1", "ENABLED", 0, "must-not-project-secret");
        JsonNode found = read(get("/admin-api/operations/targets").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer"))
                .param("kind", "APPLICATION").param("id", id));
        assertThat(found.at("/items/0/name").asText()).isEqualTo("85统计对象凭据");
        assertThat(found.at("/items/0/id").asText()).matches("APP_[0-9a-f]{32}");
        assertThat(found.toString()).doesNotContain("must-not-project-secret", "scopeCodes", "secretDigest");
        for (String kind : List.of("API", "APPLICATION")) {
            mvc.perform(get("/admin-api/operations/targets").param("kind", kind)).andExpect(status().isUnauthorized());
            mvc.perform(get("/admin-api/operations/targets").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("editor")).param("kind", kind)).andExpect(status().isForbidden());
            mvc.perform(get("/admin-api/operations/targets").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer")).param("kind", kind).param("pageSize", "101")).andExpect(status().isBadRequest());
            mvc.perform(get("/admin-api/operations/targets").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer")).param("kind", kind).param("page", "5002")).andExpect(status().isBadRequest());
            assertThat(read(get("/admin-api/operations/targets").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer")).param("kind", kind).param("id", "missing-target")).get("total").asLong()).isZero();
        }
        assertThat(read(get("/admin-api/operations/targets").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer")).param("kind", "APPLICATION").param("query", "85统计对象凭据")).get("total").asLong()).isEqualTo(1);
    }

    private CallRecord record(String api, String app, CallMode mode, int status, long duration, Instant time) {
        return CallRecord.builder().id(UUID.randomUUID().toString()).requestId(UUID.randomUUID().toString())
                .clientIp("127.0.0.1").mode(mode).apiId(api).applicationId(app).outcome(status < 300 ? "SUCCESS" : "FAILURE")
                .httpStatus(status).durationMillis(duration).occurredAt(time).build();
    }
    private MockHttpServletRequestBuilder query() {
        return get("/admin-api/operations/statistics").session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("viewer"))
                .param("from", FROM.toString()).param("to", FROM.plusSeconds(300).toString());
    }
    private JsonNode read(MockHttpServletRequestBuilder request) throws Exception {
        return json.readTree(mvc.perform(request).andExpect(status().isOk()).andReturn()
                .getResponse().getContentAsString()).get("data");
    }
}
