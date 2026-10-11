package io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.dataobject.McpTenantActivationDO;
import java.time.Instant;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface McpTenantActivationMapper extends BaseMapper<McpTenantActivationDO> {
    @Update("""
            UPDATE mcp_tenant_activation SET status=#{status},disabled_by_platform=#{disabledByPlatform},
              updated_at=#{updatedAt},revision=revision+1
            WHERE id=#{id} AND revision=#{expectedRevision}
            """)
    int updateStatus(@Param("id") String id, @Param("status") String status,
                     @Param("disabledByPlatform") boolean disabledByPlatform, @Param("updatedAt") Instant updatedAt,
                     @Param("expectedRevision") long expectedRevision);
}
