package io.github.chenyilei2016.openplatform.infrastructure.observability.dal.mapper;

import io.github.chenyilei2016.openplatform.domain.observability.ManagementAudit;
import io.github.chenyilei2016.openplatform.domain.observability.ObservationQuery;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ManagementAuditMapper {
    List<ManagementAudit> page(@Param("environmentId") String environmentId, @Param("q") ObservationQuery query);
    long count(@Param("environmentId") String environmentId, @Param("q") ObservationQuery query);
}
