package io.github.chenyilei2016.openplatform.provider;

import java.lang.annotation.*;

/** MVC参数注入认证身份；不从业务正文构造身份。 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
@Documented
public @interface CurrentOpenPlatformIdentity {}
