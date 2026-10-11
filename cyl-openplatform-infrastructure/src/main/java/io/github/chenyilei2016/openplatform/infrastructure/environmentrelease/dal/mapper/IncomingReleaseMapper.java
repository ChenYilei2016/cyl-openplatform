package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.dataobject.IncomingReleaseDO;

import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface IncomingReleaseMapper extends BaseMapper<IncomingReleaseDO> {}
