package io.github.chenyilei2016.openplatform.identity;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.List;

/** 启动时检查所有管理HTTP路由，避免新增接口遗漏声明后才在运行期被拒绝。 */
@Component
public class AdminRouteAuthorizationCheck implements SmartInitializingSingleton {
    private final ObjectProvider<RequestMappingHandlerMapping> mappings;

    public AdminRouteAuthorizationCheck(ObjectProvider<RequestMappingHandlerMapping> mappings) {
        this.mappings = mappings;
    }

    @Override
    public void afterSingletonsInstantiated() {
        List<String> missing =
                mappings.orderedStream()
                        .flatMap(mapping -> mapping.getHandlerMethods().entrySet().stream())
                        .filter(
                                entry ->
                                        entry.getKey().getPatternValues().stream()
                                                .anyMatch(
                                                        path ->
                                                                path.equals("/admin-api")
                                                                        || path.startsWith(
                                                                                "/admin-api/")))
                        .filter(entry -> !AdminAuthorization.hasDeclaration(entry.getValue()))
                        .map(
                                entry ->
                                        entry.getKey()
                                                + " -> "
                                                + entry.getValue().getShortLogMessage())
                        .sorted()
                        .toList();
        if (!missing.isEmpty()) {
            throw new IllegalStateException(
                    "管理路由必须声明有效的 @RequireAdmin：" + String.join("；", missing));
        }
    }
}
