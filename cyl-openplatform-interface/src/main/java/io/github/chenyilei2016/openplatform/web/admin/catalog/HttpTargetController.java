package io.github.chenyilei2016.openplatform.web.admin.catalog;

import io.github.chenyilei2016.openplatform.common.ApiResponse;
import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;
import io.github.chenyilei2016.openplatform.domain.runtime.HttpServiceDiscovery;
import io.github.chenyilei2016.openplatform.identity.RequireAdmin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/admin-api/apis/http-target")
@RequireAdmin(permissions = AdminPermission.MANAGE_APIS)
public class HttpTargetController {
    private final HttpServiceDiscovery discovery;
    public HttpTargetController(HttpServiceDiscovery discovery) { this.discovery = discovery; }

    /** 按合法服务名查询当前环境实例数量及检查时刻；不验证业务接口，不发送提供方请求。 */
    @GetMapping("/instances")
    public ApiResponse<HttpServiceDiscovery.Instances> instances(@RequestParam @NotBlank @Size(max = 200) String serviceName) {
        return ApiResponse.success(discovery.inspect(serviceName));
    }
}
