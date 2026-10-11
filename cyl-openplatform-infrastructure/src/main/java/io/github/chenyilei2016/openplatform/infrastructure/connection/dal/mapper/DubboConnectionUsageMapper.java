package io.github.chenyilei2016.openplatform.infrastructure.connection.dal.mapper;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionRepository.RevisionKey;
import io.github.chenyilei2016.openplatform.domain.connection.DubboConnectionUsageRepository.Usage;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface DubboConnectionUsageMapper {
    IPage<Usage> usages(@Param("environmentId") String environmentId, Page<Usage> page, @Param("connectionId") String connectionId);
    boolean isReferenced(@Param("environmentId") String environmentId, @Param("connectionId") String connectionId, @Param("revision") long revision);
    List<RevisionKey> referenced(@Param("environmentId") String environmentId, @Param("limit") int limit);
}
