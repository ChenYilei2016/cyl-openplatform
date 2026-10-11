package io.github.chenyilei2016.openplatform.infrastructure.connection.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.infrastructure.connection.dal.dataobject.DubboConnectionSummaryDO;
import io.github.chenyilei2016.openplatform.infrastructure.connection.dal.dataobject.DubboConnectionDO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface DubboConnectionMapper extends BaseMapper<DubboConnectionDO> {
    IPage<DubboConnectionSummaryDO> selectSummaries(Page<DubboConnectionSummaryDO> page, @Param("environmentId") String environmentId,
            @Param("pattern") String pattern, @Param("selectableOnly") boolean selectableOnly);

    @Select("SELECT * FROM dubbo_connection WHERE id=#{id} FOR UPDATE")
    DubboConnectionDO selectForUpdate(@Param("id") String id);
}
