package io.github.chenyilei2016.openplatform.provider.mvc;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import io.github.chenyilei2016.openplatform.provider.*;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;

import java.util.concurrent.Callable;

class OpenPlatformMvcBoundaryTest {
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        org.springframework.test.web.servlet.setup.StandaloneMockMvcBuilder builder =
                MockMvcBuilders.standaloneSetup(new Endpoints());
        builder.setPatternParser(new org.springframework.web.util.pattern.PathPatternParser());
        mvc =
                builder.addInterceptors(
                                new OpenPlatformMvcInterceptor(
                                        ProviderProofFixture.verifier(),
                                        java.util.Arrays.asList("/path/*", "/path")))
                        .setCustomArgumentResolvers(new OpenPlatformIdentityArgumentResolver())
                        .build();
    }

    @AfterEach
    void noLeakedIdentity() {
        assertFalse(OpenPlatformContext.current().isPresent());
    }

    private MockHttpServletRequestBuilder trusted(String path) {
        return trusted(path, false);
    }

    private MockHttpServletRequestBuilder trusted(String path, boolean employee) {
        java.util.Map<String, String> identity = new java.util.HashMap<>();
        identity.put("x-open-platform-application-id", "application");
        identity.put("x-open-platform-app-key", "app-key");
        identity.put("x-open-platform-tenant-id", "tenant");
        identity.put("x-request-id", "request");
        if (employee) {
            identity.put("x-open-platform-user-id", "user");
            identity.put("x-open-platform-employee-id", "employee");
            identity.put("x-open-platform-employee-no", "E1001");
        }
        MockHttpServletRequestBuilder request = get(path);
        ProviderProofFixture.SIGNER.sign(identity, OpenPlatformTarget.http(java.net.URI.create("http://provider" + path), "GET"))
                .forEach(request::header);
        return request;
    }

    @Test
    void annotationsPathsInjectionAndUnprotectedRoutes() throws Exception {
        mvc.perform(get("/identity"))
                .andExpect(status().isForbidden())
                .andExpect(content().string("{\"code\":\"INVALID_CREDENTIAL\"}"));
        mvc.perform(trusted("/identity"))
                .andExpect(status().isOk())
                .andExpect(content().string("tenant"));
        mvc.perform(get("/path/protected")).andExpect(status().isForbidden());
        mvc.perform(trusted("/path/protected")).andExpect(status().isOk());
        mvc.perform(get("/public")).andExpect(content().string("public"));
    }

    @Test
    void encodedAndMatrixPathsUseTheSameProtectionAsMvcRouting() throws Exception {
        mvc.perform(get(java.net.URI.create("/%70ath/protected")))
                .andExpect(status().isForbidden());
        mvc.perform(get(java.net.URI.create("/path;v=1/protected")))
                .andExpect(status().isForbidden());
    }

    @Test
    void encodedSeparatorsRemainOneSegmentAndInterfaceParametersStayProtected() throws Exception {
        mvc.perform(get(java.net.URI.create("/path/a%2Fb"))).andExpect(status().isForbidden());
        mvc.perform(get("/inherited")).andExpect(status().isForbidden());
        mvc.perform(trusted("/inherited")).andExpect(content().string("tenant"));
    }

    @Test
    void duplicateCredentialAndIdentityCannotReachBusiness() throws Exception {
        mvc.perform(trusted("/identity").header("x-open-platform-signature", "duplicate"))
                .andExpect(status().isForbidden());
        mvc.perform(trusted("/identity").header("x-open-platform-tenant-id", "forged"))
                .andExpect(status().isForbidden());
    }

    @Test
    void employeeRequirementsAndBusinessFailureCleanup() throws Exception {
        mvc.perform(trusted("/employee"))
                .andExpect(status().isForbidden())
                .andExpect(content().string("{\"code\":\"EMPLOYEE_REQUIRED\"}"));
        mvc.perform(
                        trusted("/employee", true))
                .andExpect(content().string("E1001"));
        assertThrows(Exception.class, () -> mvc.perform(trusted("/failure")));
        assertFalse(OpenPlatformContext.current().isPresent());
    }

    @Test
    void callableWorkerAndRedispatchRestoreTheirOwnContexts() throws Exception {
        MvcResult result =
                mvc.perform(trusted("/async")).andExpect(request().asyncStarted()).andReturn();
        assertFalse(OpenPlatformContext.current().isPresent());
        mvc.perform(asyncDispatch(result))
                .andExpect(status().isOk())
                .andExpect(content().string("tenant"));
    }

    interface InheritedIdentity {
        @GetMapping("/inherited")
        String inherited(@CurrentOpenPlatformIdentity OpenPlatformIdentity identity);
    }

    @RestController
    static class Endpoints implements InheritedIdentity {
        @Override
        public String inherited(OpenPlatformIdentity identity) {
            return identity.getTenantId();
        }

        @GetMapping("/path/{id}")
        String variablePath() {
            return "unprotected";
        }

        @OpenPlatformApi
        @GetMapping("/identity")
        String identity(@CurrentOpenPlatformIdentity OpenPlatformIdentity identity) {
            return identity.getTenantId();
        }

        @RequireOpenPlatformEmployee
        @GetMapping("/employee")
        String employee() {
            return OpenPlatformContext.requireIdentity().requireEmployee().getEmployeeNo();
        }

        @GetMapping("/path/protected")
        String path() {
            return OpenPlatformContext.requireIdentity().getTenantId();
        }

        @GetMapping("/public")
        String publicRoute() {
            return OpenPlatformContext.current().isPresent() ? "leaked" : "public";
        }

        @OpenPlatformApi
        @GetMapping("/failure")
        String failure() {
            throw new IllegalStateException("business failure");
        }

        @OpenPlatformApi
        @GetMapping("/async")
        Callable<String> async() {
            return () -> OpenPlatformContext.requireIdentity().getTenantId();
        }
    }
}
