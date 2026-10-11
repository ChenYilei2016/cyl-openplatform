package io.github.chenyilei2016.openapi.sample;

import io.github.chenyilei2016.openplatform.provider.*;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

import java.util.concurrent.Callable;

@Controller
public class SampleHttpEndpoints {
    @OpenPlatformApi
    @GetMapping("/sdk/identity")
    @ResponseBody
    public String identity(@CurrentOpenPlatformIdentity OpenPlatformIdentity identity) {
        return identity.getTenantId();
    }

    @RequireOpenPlatformEmployee
    @GetMapping("/sdk/employee")
    @ResponseBody
    public String employee() {
        return OpenPlatformContext.requireIdentity().requireEmployee().getEmployeeNo();
    }

    @GetMapping("/path/protected")
    @ResponseBody
    public String pathProtected() {
        return OpenPlatformContext.requireIdentity().getTenantId();
    }

    @OpenPlatformApi
    @GetMapping("/sdk/async")
    @ResponseBody
    public Callable<String> asynchronous() {
        return () -> OpenPlatformContext.requireIdentity().getTenantId();
    }

    @OpenPlatformApi
    @GetMapping("/sdk/forward")
    public String forward() {
        return "forward:/sdk/identity";
    }

    @OpenPlatformApi
    @GetMapping("/sdk/forward-public")
    public String forwardPublic() {
        return "forward:/internal/health";
    }

    @OpenPlatformApi
    @GetMapping("/sdk/failure")
    @ResponseBody
    public String failure() {
        throw new IllegalStateException("sample business failure");
    }

    @GetMapping("/internal/health")
    @ResponseBody
    public String health() {
        return OpenPlatformContext.current().isPresent() ? "present" : "empty";
    }
}
