package io.github.chenyilei2016.openplatform.runtime;

import io.github.chenyilei2016.openplatform.application.runtime.InvocationIdempotency;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiDefinition;
import io.github.chenyilei2016.openplatform.domain.runtime.IdempotencyGuard;
import io.github.chenyilei2016.openplatform.domain.runtime.InvocationContext;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class InvocationIdempotencyTest {
    @Test void equivalentIntegersShareADigestWithoutExpandingLargeExponents() {
        IdempotencyGuard guard = mock(IdempotencyGuard.class);
        InvocationIdempotency idempotency = new InvocationIdempotency(guard);
        ApiDefinition api = JsonMapper.builder().build().readValue("{\"id\":\"api-1\",\"draftRevision\":1,\"idempotencyField\":\"sequence\"}", ApiDefinition.class);
        InvocationContext context = new InvocationContext("app", "key", "tenant", null, null, null, List.of());
        for (String number : List.of("1", "1.0", "1e0", "1e1000000000"))
            idempotency.reserve(idempotency.prepare(api, context, Map.of("sequence", new BigDecimal(number)), "request"));
        ArgumentCaptor<IdempotencyGuard.Reservation> claims = ArgumentCaptor.forClass(IdempotencyGuard.Reservation.class);
        verify(guard, times(4)).reserve(claims.capture());
        assertThat(claims.getAllValues().subList(0, 3).stream().map(IdempotencyGuard.Reservation::valueDigest).distinct()).hasSize(1);
        assertThat(claims.getAllValues().getLast().valueDigest()).hasSize(64);
    }
}
