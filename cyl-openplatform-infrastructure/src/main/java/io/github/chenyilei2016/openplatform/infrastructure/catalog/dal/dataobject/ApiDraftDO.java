package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("catalog_api_draft")
public class ApiDraftDO {
    private String environmentId;
    @TableId(type = IdType.INPUT)
    private String id;
    private String service;
    private String version;
    private String method;
    private String name;
    private String category;
    private String owner;
    private String protocol;
    private Long draftRevision;
    private String dubboConnectionId;
    private Long dubboConnectionRevision;
    private String definitionJson;
    private String internalClass;
    private String internalMethod;
    /** 当前草稿是否打开MCP工具，供列表服务端筛选的派生列。 */
    private boolean mcpToolEnabled;
}
