package io.github.chenyilei2016.openapi.sample;

import io.github.chenyilei2016.openplatform.provider.OpenPlatformApi;
import io.github.chenyilei2016.openplatform.provider.RequireOpenPlatformEmployee;

import java.util.concurrent.CompletableFuture;

public interface SampleOperations {
    @OpenPlatformApi
    String identity(String input);

    @RequireOpenPlatformEmployee
    String employee();

    @OpenPlatformApi
    CompletableFuture<String> asynchronous(String input);

    String internal();
}
