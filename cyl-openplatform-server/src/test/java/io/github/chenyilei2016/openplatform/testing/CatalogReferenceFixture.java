package io.github.chenyilei2016.openplatform.testing;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiCategoryRepository;
import io.github.chenyilei2016.openplatform.domain.common.ObjectIdType;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.*;

/** 旧契约回归的显式分类和人员引用夹具。可读文字是测试档案主键，仍经过真实引用校验；不用于新引用规则的负向测试。 */
@TestConfiguration(proxyBeanMethods = false)
public class CatalogReferenceFixture {
    @Bean
    @DependsOnDatabaseInitialization
    InitializingBean catalogReferenceFixtures(ApiCategoryRepository categories, JdbcTemplate jdbc) {
        return () -> {
            List<String> names =
                    List.of(
                            "x", "公共交易", "公共订单", "内部待审分类", "原分类", "可见分类", "新分类", "测试", "示例", "草稿分类",
                            "订单", "运行测试");
            Set<String> existing = categories.availableNames(names, false);
            List<Object[]> rows = new ArrayList<>(), aliases = new ArrayList<>();
            for (String name : names)
                if (!existing.contains(name)) {
                    String id = ObjectIdType.API_CATEGORY.nextId();
                    rows.add(new Object[] {id, name});
                    aliases.add(new Object[] {name, id});
                }
            jdbc.batchUpdate(
                    "INSERT INTO catalog_category(id,name,enabled,revision) VALUES(?,?,true,1)",
                    rows);
            jdbc.batchUpdate(
                    "INSERT INTO catalog_category_alias(category_key,category_id) VALUES(?,?)",
                    aliases);
            List<Object[]> people =
                    List.of("owner", "内部研发", "接入维护者", "新负责人", "测试", "测试维护者", "研发", "集成测试", "验签测试")
                            .stream()
                            .map(
                                    id ->
                                            new Object[] {
                                                id, "fixture-" + id, "fixture-" + id, id, id, id
                                            })
                            .toList();
            jdbc.batchUpdate(
                    "INSERT INTO"
                        + " access_employee_profile(id,tenant_id,employee_id,user_id,employee_no,display_name,last_seen_at)"
                        + " SELECT ?,'catalog-fixture',?,?,?,?,CURRENT_TIMESTAMP WHERE NOT"
                        + " EXISTS(SELECT 1 FROM access_employee_profile WHERE id=?)",
                    people);
        };
    }
}
