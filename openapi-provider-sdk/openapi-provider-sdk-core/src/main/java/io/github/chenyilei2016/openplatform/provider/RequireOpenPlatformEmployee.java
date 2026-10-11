package io.github.chenyilei2016.openplatform.provider;

import java.lang.annotation.*;

/** 声明必须由USER委托调用的入口；同时启用内部认证。 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
@Documented
public @interface RequireOpenPlatformEmployee {}
