package io.github.chenyilei2016.openplatform.testing;

import org.springframework.context.annotation.Import;

import java.lang.annotation.*;

/** 业务HTTP回归只替换管理员登录边界；管理员管理用例另用真实数据库授权链验收。 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Import(TestAdministratorFixture.class)
public @interface TestAdministrators {}
