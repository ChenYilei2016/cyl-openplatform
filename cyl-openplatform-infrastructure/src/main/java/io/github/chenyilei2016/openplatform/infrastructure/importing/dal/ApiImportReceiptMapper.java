package io.github.chenyilei2016.openplatform.infrastructure.importing.dal;

import org.apache.ibatis.annotations.*;
import io.github.chenyilei2016.openplatform.application.importing.ImportModels.ItemResult;
import java.util.List;

@Mapper
public interface ApiImportReceiptMapper {
    record StoredReceipt(String contentDigest, String resultJson) {}
    record StoredSource(String apiId, long revision, String sourceKind, String sourceDigest) {}

    @Insert("INSERT INTO catalog_api_import_request (environment_id,tenant_id,employee_no,submission_key,content_digest,source_kind,source_digest) VALUES (#{environmentId},#{tenant},#{employee},#{key},#{digest},#{kind},#{source}) ON DUPLICATE KEY UPDATE submission_key=submission_key")
    void reserve(@Param("environmentId") String environmentId, @Param("tenant") String tenant, @Param("employee") String employee, @Param("key") String key,
                 @Param("digest") String digest, @Param("kind") String kind, @Param("source") String source);

    @Select("SELECT content_digest,result_json FROM catalog_api_import_request WHERE environment_id=#{environmentId} AND tenant_id=#{tenant} AND employee_no=#{employee} AND submission_key=#{key} FOR UPDATE")
    StoredReceipt lock(@Param("environmentId") String environmentId, @Param("tenant") String tenant, @Param("employee") String employee, @Param("key") String key);

    @Select("SELECT content_digest,result_json FROM catalog_api_import_request WHERE environment_id=#{environmentId} AND tenant_id=#{tenant} AND employee_no=#{employee} AND submission_key=#{key}")
    StoredReceipt find(@Param("environmentId") String environmentId, @Param("tenant") String tenant, @Param("employee") String employee, @Param("key") String key);

    @Update("UPDATE catalog_api_import_request SET result_json=#{result} WHERE environment_id=#{environmentId} AND tenant_id=#{tenant} AND employee_no=#{employee} AND submission_key=#{key}")
    void complete(@Param("environmentId") String environmentId, @Param("tenant") String tenant, @Param("employee") String employee, @Param("key") String key, @Param("result") String result);

    @Insert("""
            <script>
            INSERT INTO catalog_api_import_revision (environment_id,api_id,revision,operator_tenant_id,operator_employee_no,submission_key) VALUES
            <foreach collection="items" item="item" separator=",">
              (#{environmentId},#{item.apiId},#{item.revision},#{tenant},#{employee},#{key})
            </foreach>
            </script>
            """)
    void linkRevisions(@Param("environmentId") String environmentId, @Param("tenant") String tenant, @Param("employee") String employee, @Param("key") String key,
                       @Param("items") List<ItemResult> items);

    @Select("""
            SELECT r.api_id,r.revision,s.source_kind,s.source_digest
            FROM catalog_api_import_revision r
            JOIN catalog_api_import_request s ON s.tenant_id=r.operator_tenant_id
              AND s.employee_no=r.operator_employee_no AND s.submission_key=r.submission_key
            WHERE r.environment_id=#{environmentId} AND s.environment_id=#{environmentId} AND r.api_id=#{apiId} AND r.revision=#{revision}
            """)
    StoredSource provenance(@Param("environmentId") String environmentId, @Param("apiId") String apiId, @Param("revision") long revision);
}
