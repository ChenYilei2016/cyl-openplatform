package io.github.chenyilei2016.openplatform.identity;

import io.github.chenyilei2016.openplatform.domain.administration.AdminPermission;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** 管理入口动作声明；类与方法声明同时生效，方法只能增加约束。 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD, ElementType.ANNOTATION_TYPE})
public @interface RequireAdmin {
    AdminPermission[] permissions() default {};

    Match match() default Match.ALL;

    /** 总管理员身份与业务权限独立；同时声明时必须同时满足。 */
    boolean superAdministrator() default false;

    /** 仅用于会话等任何已认证管理员可访问的入口，不得与其他约束混用。 */
    boolean sessionOnly() default false;

    enum Match {
        ANY,
        ALL
    }
}
