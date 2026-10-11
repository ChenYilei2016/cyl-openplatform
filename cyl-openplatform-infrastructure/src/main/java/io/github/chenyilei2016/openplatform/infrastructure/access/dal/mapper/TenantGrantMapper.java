package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import org.apache.ibatis.annotations.Mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.TenantGrantDO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface TenantGrantMapper extends BaseMapper<TenantGrantDO> {
    @Update("""
            UPDATE access_tenant_grant SET note=#{note},note_revision=note_revision+1
            WHERE id=#{id} AND tenant_id=#{tenantId} AND status='ACTIVE' AND note_revision=#{expectedRevision}
            """)
    int updateNote(@Param("id") String id, @Param("tenantId") String tenantId,
                   @Param("note") String note, @Param("expectedRevision") long expectedRevision);

    @Update("""
            UPDATE access_tenant_grant SET status='ACTIVE',authorization_version=authorization_version+1
            WHERE id=#{id} AND status='REVOKED'
            """)
    void reactivate(@Param("id") String id);

    @Update("""
            UPDATE access_tenant_grant SET status='REVOKED',authorization_version=authorization_version+1
            WHERE id=#{id} AND status='ACTIVE'
            """)
    void revoke(@Param("id") String id);
}
