package io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.catalog.dal.dataobject.ApiCategoryDO;

import org.apache.ibatis.annotations.*;

import java.util.Collection;
import java.util.List;

@Mapper
public interface ApiCategoryMapper extends BaseMapper<ApiCategoryDO> {
    @Select("SELECT * FROM catalog_category WHERE id=#{id} FOR UPDATE")
    ApiCategoryDO lock(String id);

    @Select("SELECT category_id FROM catalog_category_alias WHERE category_key=#{name}")
    String alias(String name);

    @Select(
            "SELECT c.name FROM catalog_category_alias a JOIN catalog_category c ON"
                + " c.id=a.category_id WHERE a.category_key=#{name}")
    String displayName(String name);

    @Insert("INSERT INTO catalog_category_alias(category_key,category_id) VALUES(#{name},#{id})")
    void addAlias(@Param("name") String name, @Param("id") String id);

    @Update("UPDATE catalog_category_alias SET category_id=#{target} WHERE category_id=#{source}")
    void moveAliases(@Param("source") String source, @Param("target") String target);

    @Delete("DELETE FROM catalog_category_alias WHERE category_id=#{id}")
    void releaseUnusedNames(String id);

    record Alias(String categoryKey, String categoryId, boolean enabled) {}

    @Select(
            """
<script>
SELECT a.category_key,a.category_id,c.enabled FROM catalog_category_alias a
JOIN catalog_category c ON c.id=a.category_id WHERE a.category_key IN
<foreach collection="names" item="name" open="(" separator="," close=")">#{name}</foreach>
</script>
""")
    List<Alias> aliases(@Param("names") Collection<String> names);

    @Select(
            """
            <script>
            SELECT * FROM catalog_category WHERE id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY id FOR UPDATE
            </script>
            """)
    List<ApiCategoryDO> lockAll(@Param("ids") Collection<String> ids);

    record ReferenceCount(String id, long draftApis, long publishedApis, long historicalApis) {}

    @Select(
            """
<script>
SELECT usage_rows.id,SUM(usage_rows.draft_apis) AS draft_apis,SUM(usage_rows.published_apis) AS published_apis,SUM(usage_rows.historical_apis) AS historical_apis FROM (
  SELECT a.category_id AS id,COUNT(DISTINCT d.id) AS draft_apis,0 AS published_apis,0 AS historical_apis
  FROM catalog_category_alias a JOIN catalog_api_draft d ON d.category=a.category_key WHERE a.category_id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
  GROUP BY a.category_id
  UNION ALL
  SELECT a.category_id AS id,0 AS draft_apis,COUNT(DISTINCT r.api_id) AS published_apis,0 AS historical_apis
  FROM catalog_category_alias a JOIN publication_release r ON r.category=a.category_key WHERE a.category_id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
  GROUP BY a.category_id
  UNION ALL
  SELECT a.category_id AS id,0 AS draft_apis,0 AS published_apis,COUNT(DISTINCT r.api_id) AS historical_apis
  FROM catalog_category_alias a JOIN catalog_api_revision r ON JSON_VALUE(r.snapshot_json,'$.category')=a.category_key WHERE a.category_id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
  GROUP BY a.category_id
) usage_rows GROUP BY usage_rows.id
</script>
""")
    List<ReferenceCount> references(@Param("ids") Collection<String> ids);
}
