package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject;

import com.baomidou.mybatisplus.annotation.*;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@TableName("catalog_category")
public class ApiCategoryDO {
    @TableId(type = IdType.INPUT)
    private String id;

    private String name;
    private Boolean enabled;
    private Long revision;
}
