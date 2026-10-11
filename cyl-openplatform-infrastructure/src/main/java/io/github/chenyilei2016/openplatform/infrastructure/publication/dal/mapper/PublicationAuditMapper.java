package io.github.chenyilei2016.openplatform.infrastructure.publication.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.publication.dal.dataobject.PublicationAuditDO;

import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface PublicationAuditMapper extends BaseMapper<PublicationAuditDO> {}
