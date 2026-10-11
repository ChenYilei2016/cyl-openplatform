package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.dal.dataobject.OutgoingTransferDO;
import org.apache.ibatis.annotations.*;

@Mapper
public interface OutgoingTransferMapper extends BaseMapper<OutgoingTransferDO> {
    @Update("""
            UPDATE environment_release_transfer SET delivery_state=#{row.deliveryState},error=#{row.error},
                receipt_json=#{row.receiptJson},observations_json=#{row.observationsJson},
                updated_at=#{row.updatedAt},record_version=#{row.recordVersion}
            WHERE environment_id=#{row.environmentId} AND id=#{row.id} AND record_version=#{expectedVersion}
            """)
    int updateObservation(@Param("row") OutgoingTransferDO row, @Param("expectedVersion") long expectedVersion);
}
