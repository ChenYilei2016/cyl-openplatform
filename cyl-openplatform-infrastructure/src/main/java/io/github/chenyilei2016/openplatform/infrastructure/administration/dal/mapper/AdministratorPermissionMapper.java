package io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper;

import io.github.chenyilei2016.openplatform.infrastructure.administration.dal.dataobject.AdministratorPermissionDO;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/** 权限关联使用真实复合主键，页面与初始化均批量读写。 */
@Mapper
public interface AdministratorPermissionMapper {
    @Select(
            """
            <script>
            SELECT administrator_id, permission_code FROM platform_administrator_permission
            WHERE administrator_id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY administrator_id, permission_code
            </script>
            """)
    List<AdministratorPermissionDO> selectForAdministrators(@Param("ids") List<String> ids);

    @Insert(
            """
<script>
INSERT INTO platform_administrator_permission (administrator_id, permission_code) VALUES
<foreach collection="rows" item="row" separator=",">(#{row.administratorId}, #{row.permissionCode})</foreach>
</script>
""")
    void insertAll(@Param("rows") List<AdministratorPermissionDO> rows);

    @Delete("DELETE FROM platform_administrator_permission WHERE administrator_id = #{id}")
    void deleteForAdministrator(@Param("id") String id);
}
