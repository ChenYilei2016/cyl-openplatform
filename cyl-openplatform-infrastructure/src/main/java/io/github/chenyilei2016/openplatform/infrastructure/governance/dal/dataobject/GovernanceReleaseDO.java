package io.github.chenyilei2016.openplatform.infrastructure.governance.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("gateway_governance_release")
public class GovernanceReleaseDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String ruleId;
    private Long stateVersion;
    private String name;
    private String ruleJson;
    private Instant publishedAt;
    private String sourceReleaseId;
    private String operatorTenantId;
    private String operatorEmployeeNo;
    private String previewDigest;
}
