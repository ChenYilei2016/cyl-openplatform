package io.github.chenyilei2016.openplatform.infrastructure.operations.alerts.dal.dataobject;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import java.math.BigDecimal;
import lombok.Getter;
import lombok.Setter;

@Getter @Setter
@TableName("platform_alert_policy")
public class AlertPolicyDO {
    @TableId(type = IdType.INPUT) private String id;
    private Long version;
    private Integer windowMinutes;
    private Long minRequests;
    private Boolean failureEnabled;
    private BigDecimal failureRateThreshold;
    private Boolean latencyEnabled;
    private Long averageLatencyThresholdMillis;
}
