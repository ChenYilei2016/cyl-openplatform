package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.*;

import java.time.Instant;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("access_employee_profile")
public class EmployeeProfileDO {
    @TableId(type = IdType.INPUT)
    private String id;

    private String tenantId;
    private String tenantName;
    private String employeeId;
    private String userId;
    private String employeeNo;
    private String displayName;
    private Instant lastSeenAt;
}
