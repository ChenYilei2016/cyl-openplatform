package io.github.chenyilei2016.openplatform.application.access;

public record RotatedSecret(String appKey, String appSecret) {
    @Override public String toString() { return "RotatedSecret[appKey=" + appKey + "]"; }
}
