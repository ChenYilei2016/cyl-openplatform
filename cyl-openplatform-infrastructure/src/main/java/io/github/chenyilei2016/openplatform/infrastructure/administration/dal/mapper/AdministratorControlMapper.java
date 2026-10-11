package io.github.chenyilei2016.openplatform.infrastructure.administration.dal.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

/** 固定控制行用于串行化管理员写操作，保护最后一名总管理员。 */
@Mapper
public interface AdministratorControlMapper {
    @Select("SELECT id FROM platform_administrator_control WHERE id = 1 FOR UPDATE")
    Integer lock();
}
