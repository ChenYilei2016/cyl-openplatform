package io.github.chenyilei2016.openplatform.infrastructure.signature.dal.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import io.github.chenyilei2016.openplatform.domain.signature.*;
import io.github.chenyilei2016.openplatform.infrastructure.signature.dal.dataobject.SigningKeyDO;
import io.github.chenyilei2016.openplatform.infrastructure.signature.dal.mapper.SigningKeyMapper;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class SigningKeyRepositoryImpl implements SigningKeyRepository {
    private final SigningKeyMapper mapper;

    @Override public Optional<SigningKey> findByApplication(String id) {
        return Optional.ofNullable(mapper.selectById(id)).map(SigningKeyRepositoryImpl::metadata);
    }
    @Override public Optional<SigningKey> findByKeyId(String id) {
        return Optional.ofNullable(mapper.selectOne(new LambdaQueryWrapper<SigningKeyDO>().eq(SigningKeyDO::getKeyId, id)))
                .map(SigningKeyRepositoryImpl::metadata);
    }
    @Override public Optional<SigningSecret> findSecret(SigningKey key) {
        return Optional.ofNullable(mapper.selectOne(new LambdaQueryWrapper<SigningKeyDO>()
                .eq(SigningKeyDO::getApplicationId, key.applicationId()).eq(SigningKeyDO::getKeyId, key.keyId())
                .eq(SigningKeyDO::getRevision, key.revision()).eq(SigningKeyDO::getStatus, SigningKeyStatus.ACTIVE.name())))
                .map(row -> new SigningSecret(row.getWrappingKeyId(), row.getEncryptedSecret()));
    }
    @Override public void save(SigningKey key, SigningSecret secret) {
        var row = new SigningKeyDO(key.applicationId(), key.keyId(), key.revision(), key.status().name(),
                secret == null ? null : secret.wrappingKeyId(), secret == null ? null : secret.encryptedSecret(), key.createdAt(), key.changedAt());
        if (key.revision() == 1) mapper.insert(row); else mapper.updateById(row);
    }
    private static SigningKey metadata(SigningKeyDO row) {
        return new SigningKey(row.getKeyId(), row.getApplicationId(), row.getRevision(), SigningKeyStatus.valueOf(row.getStatus()), row.getCreatedAt(), row.getChangedAt());
    }
}
