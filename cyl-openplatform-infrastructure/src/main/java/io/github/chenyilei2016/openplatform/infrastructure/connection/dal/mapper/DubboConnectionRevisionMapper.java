package io.github.chenyilei2016.openplatform.infrastructure.connection.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.connection.dal.dataobject.DubboConnectionRevisionDO;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface DubboConnectionRevisionMapper extends BaseMapper<DubboConnectionRevisionDO> {}
