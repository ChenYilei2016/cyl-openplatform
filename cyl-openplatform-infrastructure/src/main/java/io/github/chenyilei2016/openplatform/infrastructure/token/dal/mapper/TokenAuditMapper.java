package io.github.chenyilei2016.openplatform.infrastructure.token.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.token.dal.dataobject.TokenAuditDO;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface TokenAuditMapper extends BaseMapper<TokenAuditDO> {}
