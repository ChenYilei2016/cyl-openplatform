package io.github.chenyilei2016.openplatform.domain.operations;

import java.time.Instant;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum StatisticsBucket {
    MINUTE(1), FIVE_MINUTES(5), HOUR(60);
    private final int minutes;
    public long index(Instant instant) { return Math.floorDiv(instant.getEpochSecond(), minutes * 60L); }
    public Instant start(long index) { return Instant.ofEpochSecond(index * minutes * 60L); }
}
