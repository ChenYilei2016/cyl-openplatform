package io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject;

import lombok.Data;

@Data
public class TenantScopePermissionDO {
    private String id;
    private String code;
    private String name;
    private Boolean enabled;
    private Boolean publicAccess;
    private Boolean defaultForNewApplication;
    private String grantId;
    private String grantStatus;
}
