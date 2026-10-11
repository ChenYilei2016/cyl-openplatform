package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import org.apache.ibatis.annotations.Mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.AccessAuditDO;

@Mapper
public interface AccessAuditMapper extends BaseMapper<AccessAuditDO> {
}
