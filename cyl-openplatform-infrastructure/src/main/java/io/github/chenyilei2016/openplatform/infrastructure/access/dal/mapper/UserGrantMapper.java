package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import org.apache.ibatis.annotations.Mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.UserGrantDO;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface UserGrantMapper extends BaseMapper<UserGrantDO> {
    @Update("""
            UPDATE access_user_grant SET user_id=#{grant.userId},employee_no=#{grant.employeeNo},
              display_name=#{grant.displayName},status='ACTIVE',authorization_version=authorization_version+1
            WHERE id=#{grant.id} AND status='REVOKED'
            """)
    void reactivate(@Param("grant") UserGrantDO grant);

    @Update("""
            UPDATE access_user_grant SET status='REVOKED',authorization_version=authorization_version+1
            WHERE id=#{id} AND status='ACTIVE'
            """)
    void revoke(@Param("id") String id);

    @Update("""
            UPDATE access_user_grant SET status='REVOKED',authorization_version=authorization_version+1
            WHERE tenant_grant_id=#{tenantGrantId} AND status='ACTIVE'
            """)
    void revokeByTenant(@Param("tenantGrantId") String tenantGrantId);
}
