package io.github.chenyilei2016.openplatform.web.internal.environmentrelease;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfile;
import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileQuery;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;
import io.github.chenyilei2016.openplatform.application.environmentrelease.EnvironmentReleaseReceiver;
import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.common.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.EnvironmentReleaseModels.*;
import io.github.chenyilei2016.openplatform.domain.environmentrelease.ReleaseEnvironment;
import io.github.chenyilei2016.openplatform.web.shared.common.JsonRequestReader;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.*;

import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.math.BigInteger;
import java.util.Collections;
import java.util.Map;
import java.util.Set;

/** 运维信任的环境机器入口；不创建管理会话、不接受浏览器传入地址或凭据。 */
@RestController
@RequestMapping("/internal-api/environment-releases/v1")
@RequiredArgsConstructor
public class EnvironmentReleaseReceiverController {
    private static final String UUID_PATTERN =
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    private final EnvironmentReleaseReceiver receiver;
    private final ReleaseEnvironment environment;
    private final JsonRequestReader requests;
    private final JsonMapper json;

    @GetMapping("/dubbo-connections")
    public ApiResponse<ConnectionDirectory> connections(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(defaultValue = "") String query,
            HttpServletRequest request, HttpServletResponse response) {
        authenticate(request, response);
        if (page < 1 || pageSize < 1 || pageSize > 100 || (long) (page - 1) * pageSize > 100_000 || query.length() > 100) invalid();
        return ApiResponse.success(receiver.connections(page, pageSize, query));
    }

    @GetMapping("/owners")
    public ApiResponse<PageResult<EmployeeProfile>> owners(
            @RequestParam String tenantId, @RequestParam(required=false) String name,
            @RequestParam(required=false) String employeeNo, @RequestParam(defaultValue="1") int page,
            @RequestParam(defaultValue="20") int pageSize, HttpServletRequest request, HttpServletResponse response) {
        authenticate(request,response);
        return ApiResponse.success(receiver.owners(new EmployeeProfileQuery(tenantId,employeeNo,name,page,pageSize)));
    }
    @PostMapping(value = "/preview", consumes = "application/json")
    public ApiResponse<Preview> preview(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        String source = authenticate(request, response);
        Map<String, Object> body = requests.readObject(request, 262_144);
        if (!body.keySet().equals(Set.of("sourceEnvironment", "targetEnvironment", "definition")))
            invalid();
        PreviewRequest preview = convert(body, PreviewRequest.class);
        matching(source, preview.sourceEnvironment(), preview.targetEnvironment());
        return ApiResponse.success(receiver.preview(preview));
    }

    @PostMapping(value = "/receive", consumes = "application/json")
    public ApiResponse<Receipt> receive(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        String source = authenticate(request, response);
        Map<String, Object> body = requests.readObject(request, 262_144);
        if (!body.keySet()
                .equals(
                        Set.of(
                                "transferId",
                                "sourceEnvironment",
                                "targetEnvironment",
                                "sourceReleaseId",
                                "operatorTenantId",
                                "operatorEmployeeNo",
                                "expectedRevision",
                                "previewDigest",
                                "definition",
                                "comment"))) invalid();
        Object value = body.get("expectedRevision");
        if (!(value instanceof Integer || value instanceof Long || value instanceof BigInteger))
            invalid();
        BigInteger revision = new BigInteger(value.toString());
        if (revision.signum() < 0 || revision.compareTo(BigInteger.valueOf(Long.MAX_VALUE)) >= 0)
            invalid();
        SendRequest send = convert(body, SendRequest.class);
        matching(source, send.sourceEnvironment(), send.targetEnvironment());
        if (send.transferId() == null
                || !send.transferId().matches(UUID_PATTERN)
                || send.sourceReleaseId() == null
                || !ObjectIdType.API_RELEASE.accepts(send.sourceReleaseId())
                || send.previewDigest() == null
                || !send.previewDigest().matches("[0-9a-f]{64}")
                || send.operatorTenantId() == null
                || send.operatorTenantId().isBlank()
                || send.operatorTenantId().length() > 64
                || send.operatorEmployeeNo() == null
                || send.operatorEmployeeNo().isBlank()
                || send.operatorEmployeeNo().length() > 64
                || send.comment() == null
                || send.comment().length() > 500) invalid();
        return ApiResponse.success(receiver.receive(send, org.slf4j.MDC.get("requestId")));
    }

    @GetMapping("/receipts/{transferId}")
    public ApiResponse<Receipt> receipt(
            @PathVariable String transferId,
            HttpServletRequest request,
            HttpServletResponse response) {
        String source = authenticate(request, response);
        if (!transferId.matches(UUID_PATTERN)) invalid();
        return ApiResponse.success(receiver.receipt(source, transferId));
    }

    private String authenticate(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        var authorization = Collections.list(request.getHeaders("Authorization"));
        var sources = Collections.list(request.getHeaders("X-Platform-Source"));
        if (authorization.size() != 1
                || sources.size() != 1
                || !authorization.getFirst().matches("Bearer [!-~]{32,512}")
                || !sources.getFirst().matches("[a-z][a-z0-9_-]{0,47}"))
            throw new PlatformException(ErrorCode.UNAUTHENTICATED, "环境传输身份无效");
        String source = sources.getFirst();
        environment.authenticate(source, authorization.getFirst().substring(7));
        return source;
    }

    private void matching(String authenticated, String source, String target) {
        if (!authenticated.equals(source) || !environment.environmentId().equals(target))
            throw new PlatformException(ErrorCode.FORBIDDEN, "环境传输来源或目标不匹配");
    }

    private <T> T convert(Map<String, Object> body, Class<T> type) {
        try {
            return json.convertValue(body, type);
        } catch (RuntimeException invalid) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "环境传输正文不合法");
        }
    }

    private static void invalid() {
        throw new PlatformException(ErrorCode.INVALID_REQUEST, "环境传输字段缺失或格式不合法");
    }
}
