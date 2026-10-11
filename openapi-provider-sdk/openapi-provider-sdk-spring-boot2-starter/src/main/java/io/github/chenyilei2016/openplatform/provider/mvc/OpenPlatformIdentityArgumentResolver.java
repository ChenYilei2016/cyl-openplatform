package io.github.chenyilei2016.openplatform.provider.mvc;

import io.github.chenyilei2016.openplatform.provider.CurrentOpenPlatformIdentity;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformContext;
import io.github.chenyilei2016.openplatform.provider.OpenPlatformIdentity;

import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

public final class OpenPlatformIdentityArgumentResolver implements HandlerMethodArgumentResolver {
    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentOpenPlatformIdentity.class);
    }

    @Override
    public Object resolveArgument(
            MethodParameter parameter,
            ModelAndViewContainer container,
            NativeWebRequest request,
            WebDataBinderFactory binder) {
        if (parameter.getParameterType() != OpenPlatformIdentity.class)
            throw new IllegalArgumentException(
                    "@CurrentOpenPlatformIdentity参数必须为OpenPlatformIdentity");
        return OpenPlatformContext.requireIdentity();
    }
}
