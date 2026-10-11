package io.github.chenyilei2016.openplatform.domain.publication;

public enum ReleaseStatus {
    PENDING,
    APPLIED,
    REJECTED,
    FAILED;

    public boolean pending() {
        return this == PENDING;
    }
}
