package io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.dataobject.McpToolSetDO;
import java.util.List;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface McpToolSetMapper extends BaseMapper<McpToolSetDO> {
    @Select("SELECT * FROM mcp_tool_set WHERE environment_id=#{environmentId} AND id=#{id} FOR UPDATE")
    McpToolSetDO lock(@Param("environmentId") String environmentId, @Param("id") String id);
    @Select("SELECT api_id FROM mcp_tool_set_member WHERE environment_id=#{environmentId} AND tool_set_id=#{id} ORDER BY api_id LIMIT 201")
    List<String> members(@Param("environmentId") String environmentId, @Param("id") String id);
    @Delete("DELETE FROM mcp_tool_set_member WHERE environment_id=#{environmentId} AND tool_set_id=#{id}")
    int deleteMembers(@Param("environmentId") String environmentId, @Param("id") String id);
    @Insert("""
            <script>INSERT INTO mcp_tool_set_member(environment_id,tool_set_id,api_id) VALUES
            <foreach collection="apiIds" item="apiId" separator=",">(#{environmentId},#{id},#{apiId})</foreach>
            </script>
            """)
    int insertMembers(@Param("environmentId") String environmentId, @Param("id") String id, @Param("apiIds") List<String> apiIds);
}
