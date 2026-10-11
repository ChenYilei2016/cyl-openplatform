package io.github.chenyilei2016.openplatform.infrastructure.access.dal.mapper;

import org.apache.ibatis.annotations.Mapper;
import io.github.chenyilei2016.openplatform.infrastructure.access.dal.dataobject.ApplicationScopeDO;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.util.List;

/** 应用和Scope采用复合主键，关联以批量方式读写，不构造伪造的单列ID。 */
@Mapper
public interface ApplicationScopeMapper {
    @Select("""
            <script>
            SELECT application_id,scope_code FROM access_application_scope
            WHERE application_id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY scope_code
            </script>
            """)
    List<ApplicationScopeDO> selectByApplications(@Param("ids") List<String> ids);

    @Insert("""
            <script>
            INSERT INTO access_application_scope (application_id,scope_code) VALUES
            <foreach collection="codes" item="code" separator=",">(#{applicationId},#{code})</foreach>
            </script>
            """)
    void insertScopes(@Param("applicationId") String applicationId, @Param("codes") List<String> codes);

    @Delete("DELETE FROM access_application_scope WHERE application_id=#{applicationId}")
    void deleteByApplication(@Param("applicationId") String applicationId);
}
