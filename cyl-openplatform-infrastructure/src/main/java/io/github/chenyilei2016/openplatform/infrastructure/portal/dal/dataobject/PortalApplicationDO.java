package io.github.chenyilei2016.openplatform.infrastructure.portal.dal.dataobject;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** 只读关联查询行，不映射应用密钥列。 */
@Getter
@Setter
@NoArgsConstructor
public class PortalApplicationDO {
    private String id;
    private String applicationId;
    private String appKey;
    private String name;
    private String globalName;
    private String applicationStatus;
    private String status;
    private Long authorizationVersion;
    private String note;
    private Long noteRevision;
}
