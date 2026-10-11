package io.github.chenyilei2016.openplatform.infrastructure.governance.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@TableName("gateway_governance_rule")
public class GovernanceRuleDO {
    @TableId(type = IdType.INPUT)
    private String id;
    private String name;
    private String targetType;
    private String tenantId;
    private String applicationId;
    private String apiId;
    private String liveMode;
    private String configJson;
    private Long draftRevision;
    private Long stateVersion;
    private String liveReleaseId;
    private String liveRuleJson;
    @TableField(exist = false)
    private String applicationName;
    @TableField(exist = false)
    private String appKey;
    @TableField(exist = false)
    private String apiName;
    @TableField(exist = false)
    private String apiService;
    @TableField(exist = false)
    private String apiVersion;
    @TableField(exist = false)
    private String apiMethod;
    @TableField(exist = false)
    private String liveName;

}
