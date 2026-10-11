package io.github.chenyilei2016.openplatform.application.administration;

import io.github.chenyilei2016.openplatform.domain.administration.AdministratorRepository;
import io.github.chenyilei2016.openplatform.domain.administration.OperatorRef;
import java.util.Map;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 管理操作记录按当前页批量补充操作人姓名；未登记管理员时由页面回退显示工号。 */
@Service
@RequiredArgsConstructor
public class OperatorNames {
    private final AdministratorRepository administrators;

    public Map<OperatorRef, String> of(Stream<OperatorRef> operators) {
        return administrators.displayNames(operators
                .filter(operator -> operator.tenantId() != null && operator.employeeNo() != null)
                .distinct().toList());
    }

}
