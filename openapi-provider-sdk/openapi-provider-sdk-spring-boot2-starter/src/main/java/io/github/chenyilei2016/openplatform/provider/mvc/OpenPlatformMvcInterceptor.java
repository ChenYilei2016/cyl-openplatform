package io.github.chenyilei2016.openplatform.provider.mvc;

import io.github.chenyilei2016.openplatform.provider.*;

import org.springframework.core.MethodParameter;
import org.springframework.http.server.PathContainer;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.async.CallableProcessingInterceptor;
import org.springframework.web.context.request.async.WebAsyncUtils;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.AsyncHandlerInterceptor;
import org.springframework.web.util.ServletRequestPathUtils;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.concurrent.Callable;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/** 在MVC参数转换前认证；同步、Callable及异步redispatch分别绑定并恢复所在线程。 */
public final class OpenPlatformMvcInterceptor implements AsyncHandlerInterceptor {
    private static final String SCOPE = OpenPlatformMvcInterceptor.class.getName() + ".scope";
    private static final String VERIFIED_IDENTITY = OpenPlatformMvcInterceptor.class.getName() + ".identity";
    private final OpenPlatformVerifier verifier;
    private final List<String> protectedPaths;
    private final AntPathMatcher paths = new AntPathMatcher();
    private final List<PathPattern> parsedPaths;

    public OpenPlatformMvcInterceptor(OpenPlatformVerifier verifier, List<String> protectedPaths) {
        this.verifier = verifier;
        if (protectedPaths == null || protectedPaths.size() > 64)
            throw new IllegalArgumentException("受保护路径最多64条");
        for (String path : protectedPaths)
            if (path == null
                    || !path.startsWith("/")
                    || path.length() > 256
                    || !path.equals(path.trim()))
                throw new IllegalArgumentException("受保护路径必须以/开头且不超过256字符");
        this.protectedPaths = Collections.unmodifiableList(new ArrayList<>(protectedPaths));
        paths.setCaseSensitive(false);
        PathPatternParser parser = new PathPatternParser();
        parser.setCaseSensitive(false);
        List<PathPattern> compiled = new ArrayList<>();
        for (String pattern : protectedPaths) compiled.add(parser.parse(pattern));
        parsedPaths = Collections.unmodifiableList(compiled);
    }

    @Override
    public boolean preHandle(
            HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        OpenPlatformEndpointPolicy policy =
                handler instanceof HandlerMethod
                        ? policy((HandlerMethod) handler)
                        : OpenPlatformEndpointPolicy.UNPROTECTED;
        boolean pathProtected = matchesProtectedPath(request);
        if (!policy.isProtected() && !pathProtected) {
            pushScope(request, null);
            return true;
        }
        try {
            OpenPlatformIdentity identity = authenticateRequest(request);
            policy.validate(identity);
            OpenPlatformContext.Scope scope = OpenPlatformContext.open(identity);
            pushScope(request, scope);
            OpenPlatformContext.Snapshot snapshot = OpenPlatformContext.snapshot();
            WebAsyncUtils.getAsyncManager(request)
                    .registerCallableInterceptor(
                            SCOPE,
                            new CallableProcessingInterceptor() {
                                private OpenPlatformContext.Scope workerScope;

                                @Override
                                public <T> void preProcess(
                                        NativeWebRequest ignored, Callable<T> task) {
                                    workerScope = snapshot.open();
                                }

                                @Override
                                public <T> void postProcess(
                                        NativeWebRequest ignored, Callable<T> task, Object result) {
                                    if (workerScope != null) {
                                        workerScope.close();
                                        workerScope = null;
                                    }
                                }
                            });
            return true;
        } catch (OpenPlatformException rejected) {
            response.setStatus(rejected.getReason().getStatus());
            response.setHeader("X-Open-Platform-Error", rejected.getReason().name());
            response.setContentType("application/json");
            response.getWriter().write("{\"code\":\"" + rejected.getReason().name() + "\"}");
            return false;
        }
    }

    /** 容器内部forward/async派发复用本次已验证身份；不会给另一个HTTP请求授信。 */
    private OpenPlatformIdentity authenticateRequest(HttpServletRequest request) {
        OpenPlatformIdentity existing = (OpenPlatformIdentity) request.getAttribute(VERIFIED_IDENTITY);
        if (request.getDispatcherType() != javax.servlet.DispatcherType.REQUEST && existing != null) return existing;
        OpenPlatformTarget target;
        try {
            target = OpenPlatformTarget.http(URI.create("http://provider" + request.getRequestURI()
                    + (request.getQueryString() == null ? "" : "?" + request.getQueryString())), request.getMethod());
        } catch (IllegalArgumentException invalid) {
            throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_INVOCATION);
        }
        OpenPlatformIdentity identity = verifier.authenticate(name -> singleHeader(request, name), target);
        request.setAttribute(VERIFIED_IDENTITY, identity);
        return identity;
    }

    public static OpenPlatformEndpointPolicy policy(HandlerMethod handler) {
        OpenPlatformEndpointPolicy resolved =
                OpenPlatformEndpointPolicy.resolve(handler.getBeanType(), handler.getMethod());
        if (resolved.isProtected()) return resolved;
        for (MethodParameter parameter : handler.getMethodParameters())
            if (parameter.hasParameterAnnotation(CurrentOpenPlatformIdentity.class))
                return OpenPlatformEndpointPolicy.APPLICATION;
        return resolved;
    }

    private static String singleHeader(HttpServletRequest request, String name) {
        Enumeration<String> values = request.getHeaders(name);
        if (values == null || !values.hasMoreElements()) return null;
        String value = values.nextElement();
        if (values.hasMoreElements())
            throw new OpenPlatformException(OpenPlatformException.Reason.INVALID_IDENTITY);
        return value;
    }

    @Override
    public void afterCompletion(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception failure) {
        closeScope(request);
    }

    @Override
    public void afterConcurrentHandlingStarted(
            HttpServletRequest request, HttpServletResponse response, Object handler) {
        closeScope(request);
    }

    private static void closeScope(HttpServletRequest request) {
        DispatchScope frame = (DispatchScope) request.getAttribute(SCOPE);
        if (frame == null) return;
        if (frame.scope != null) frame.scope.close();
        if (frame.previous == null) request.removeAttribute(SCOPE);
        else request.setAttribute(SCOPE, frame.previous);
    }

    private static void pushScope(HttpServletRequest request, OpenPlatformContext.Scope scope) {
        request.setAttribute(
                SCOPE, new DispatchScope(scope, (DispatchScope) request.getAttribute(SCOPE)));
    }

    private static final class DispatchScope {
        private final OpenPlatformContext.Scope scope;
        private final DispatchScope previous;

        private DispatchScope(OpenPlatformContext.Scope scope, DispatchScope previous) {
            this.scope = scope;
            this.previous = previous;
        }
    }

    /** 保留MVC解析后的段边界，不能把包含编码斜杠的单段重新拼成多个段。 */
    private boolean matchesProtectedPath(HttpServletRequest request) {
        Object cached = ServletRequestPathUtils.getCachedPath(request);
        if (cached instanceof String) {
            String path = (String) cached;
            String withoutTrailingSlash =
                    path.length() > 1 && path.endsWith("/")
                            ? path.substring(0, path.length() - 1)
                            : path;
            return protectedPaths.stream()
                    .anyMatch(
                            pattern ->
                                    paths.match(pattern, path)
                                            || paths.match(pattern, withoutTrailingSlash));
        }
        PathContainer path = (PathContainer) cached;
        int count = path.elements().size();
        PathContainer withoutTrailingSlash =
                count > 1 && "/".equals(path.elements().get(count - 1).value())
                        ? path.subPath(0, count - 1)
                        : path;
        return parsedPaths.stream()
                .anyMatch(
                        pattern -> pattern.matches(path) || pattern.matches(withoutTrailingSlash));
    }
}
