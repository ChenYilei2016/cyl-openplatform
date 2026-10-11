package io.github.chenyilei2016.openplatform.application.catalog;

import io.github.chenyilei2016.openplatform.domain.access.EmployeeProfileRepository;
import io.github.chenyilei2016.openplatform.domain.catalog.*;
import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Component;

import java.util.*;

/** 普通保存和批量导入复用同一引用规则；按一批查分类和人员，不逐接口查库。 */
@Component
@RequiredArgsConstructor
public class CatalogReferencePolicy {
    private final ApiCategoryRepository categories;
    private final EmployeeProfileRepository profiles;

    public record Available(Set<String> categories, Set<String> owners) {
        public List<FieldValidation.Issue> issues(ApiDefinition definition) {
            List<FieldValidation.Issue> errors = new ArrayList<>();
            if (!categories.contains(definition.category()))
                errors.add(
                        new FieldValidation.Issue(
                                "/category",
                                FieldValidation.Reason.REFERENCE_UNAVAILABLE,
                                "请选择已维护的有效分类；新分类请先在分类管理中创建"));
            if (!owners.contains(definition.owner()))
                errors.add(
                        new FieldValidation.Issue(
                                "/owner",
                                FieldValidation.Reason.REFERENCE_UNAVAILABLE,
                                "请搜索并选择负责人，不能使用自由填写的名称"));
            return errors;
        }

        public void require(ApiDefinition definition) {
            FieldValidation checks = new FieldValidation();
            issues(definition).forEach(checks::add);
            checks.requireValid();
        }
    }

    public Available check(Collection<ApiDefinition> definitions, boolean lock) {
        if (definitions.size() > 100) throw new IllegalArgumentException("引用检查最多100个API");
        Set<String> names = new HashSet<>(), owners = new HashSet<>();
        for (ApiDefinition definition : definitions) {
            if (definition.category() != null) names.add(definition.category());
            if (definition.owner() != null) owners.add(definition.owner());
        }
        return new Available(
                categories.availableNames(names, lock),
                Set.copyOf(profiles.findByIds(owners).keySet()));
    }
}
