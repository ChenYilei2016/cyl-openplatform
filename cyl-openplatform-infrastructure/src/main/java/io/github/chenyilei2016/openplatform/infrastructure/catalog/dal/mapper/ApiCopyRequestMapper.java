package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper;

import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiCopyRequestDO;
import org.apache.ibatis.annotations.*;

@Mapper
public interface ApiCopyRequestMapper {
    @Insert("INSERT INTO catalog_api_copy_request (environment_id,tenant_id, employee_no, creation_key, content_digest) VALUES (#{environmentId},#{tenantId}, #{employeeNo}, #{creationKey}, #{digest}) ON DUPLICATE KEY UPDATE creation_key=creation_key")
    void reserve(@Param("environmentId") String environmentId, @Param("tenantId") String tenantId, @Param("employeeNo") String employeeNo,
                 @Param("creationKey") String creationKey, @Param("digest") String digest);

    @Select("SELECT content_digest,result_json FROM catalog_api_copy_request WHERE environment_id=#{environmentId} AND tenant_id=#{tenantId} AND employee_no=#{employeeNo} AND creation_key=#{creationKey} FOR UPDATE")
    ApiCopyRequestDO lock(@Param("environmentId") String environmentId, @Param("tenantId") String tenantId, @Param("employeeNo") String employeeNo, @Param("creationKey") String creationKey);

    @Select("SELECT content_digest,result_json FROM catalog_api_copy_request WHERE environment_id=#{environmentId} AND tenant_id=#{tenantId} AND employee_no=#{employeeNo} AND creation_key=#{creationKey}")
    ApiCopyRequestDO find(@Param("environmentId") String environmentId, @Param("tenantId") String tenantId, @Param("employeeNo") String employeeNo, @Param("creationKey") String creationKey);

    @Update("UPDATE catalog_api_copy_request SET result_json=#{result} WHERE environment_id=#{environmentId} AND tenant_id=#{tenantId} AND employee_no=#{employeeNo} AND creation_key=#{creationKey}")
    void complete(@Param("environmentId") String environmentId, @Param("tenantId") String tenantId, @Param("employeeNo") String employeeNo,
                  @Param("creationKey") String creationKey, @Param("result") String result);
}
