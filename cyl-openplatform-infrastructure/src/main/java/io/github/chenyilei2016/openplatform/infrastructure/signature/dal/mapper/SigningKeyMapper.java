package io.github.chenyilei2016.openplatform.infrastructure.signature.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.signature.dal.dataobject.SigningKeyDO;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface SigningKeyMapper extends BaseMapper<SigningKeyDO> {}
