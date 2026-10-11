package io.github.chenyilei2016.openplatform.infrastructure.mcp.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@TableName("mcp_tool_set")
public class McpToolSetDO {
    private String environmentId;
    @TableId(type = IdType.INPUT)
    private String id;
    private String code;
    private String name;
    private String description;
    private Boolean enabled;
    private Long revision;
}
