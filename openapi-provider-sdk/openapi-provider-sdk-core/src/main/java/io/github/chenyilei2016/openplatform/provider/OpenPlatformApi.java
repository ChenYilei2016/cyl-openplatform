package io.github.chenyilei2016.openplatform.provider;

import java.lang.annotation.*;

/** 声明受开放平台内部认证保护的入口。 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
@Documented
public @interface OpenPlatformApi {}
