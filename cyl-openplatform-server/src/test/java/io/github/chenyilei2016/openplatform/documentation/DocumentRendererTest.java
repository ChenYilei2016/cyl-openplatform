package io.github.chenyilei2016.openplatform.documentation;

import io.github.chenyilei2016.openplatform.domain.catalog.ApiDocument;
import io.github.chenyilei2016.openplatform.domain.catalog.ApiLifecycle;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaNode;
import io.github.chenyilei2016.openplatform.domain.catalog.SchemaType;
import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentFormat;
import io.github.chenyilei2016.openplatform.domain.documentation.DocumentView;
import io.github.chenyilei2016.openplatform.infrastructure.documentation.ApiDocumentRenderer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.AbstractList;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.*;

class DocumentRendererTest {
    private final ApiDocumentRenderer renderer = new ApiDocumentRenderer(JsonMapper.builder().build());

    @Test
    void rejectsOversizedJsonAndEscapedHtmlAndReleasesCapacityAfterEveryFailure() {
        for (int attempt = 0; attempt < 5; attempt++) {
            for (DocumentFormat format : DocumentFormat.values()) {
                // 聚合输出边界独立于入口快照大小，字节超限不得返回截断文件。
                var document = document(List.of("<".repeat(2 * 1024 * 1024)));
                assertThatThrownBy(() -> renderer.render(document, format))
                        .isInstanceOfSatisfying(PlatformException.class,
                                failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.REQUEST_TOO_LARGE));
            }
        }
        String html = new String(renderer.render(document(List.of("正常")), DocumentFormat.HTML).bytes(), java.nio.charset.StandardCharsets.UTF_8);
        assertThat(html).contains("Bearer", "SZ-HMAC-SHA256", "/api/sign/orders/v1/query", "white-space:pre-wrap");
    }

    @Test
    void refusesAQueueWhenFourRealRenderCallsAreOccupiedAndRecoversCapacity() throws Exception {
        var entered = new CountDownLatch(4);
        var release = new CountDownLatch(1);
        List<String> delayedExample = new AbstractList<>() {
            @Override public int size() { return 1; }
            @Override public String get(int index) {
                entered.countDown();
                try {
                    if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("测试序列化等待超时");
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(interrupted);
                }
                return "已完成";
            }
        };
        var executor = Executors.newFixedThreadPool(4);
        List<Future<?>> tasks = new ArrayList<>();
        try {
            for (int index = 0; index < 4; index++) tasks.add(executor.submit(() -> renderer.render(document(delayedExample), DocumentFormat.JSON)));
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> renderer.render(document(List.of("第五个请求")), DocumentFormat.HTML))
                    .isInstanceOfSatisfying(PlatformException.class,
                            failure -> assertThat(failure.getErrorCode()).isEqualTo(ErrorCode.RATE_LIMITED));
            release.countDown();
            for (Future<?> task : tasks) task.get(5, TimeUnit.SECONDS);
            assertThat(renderer.render(document(List.of("恢复")), DocumentFormat.JSON).bytes()).isNotEmpty();
        } finally {
            release.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    private DocumentView document(Object example) {
        SchemaNode item = new SchemaNode(SchemaType.STRING, "文本", false, Map.of(), null, List.of(), null, null, false);
        SchemaNode schema = new SchemaNode(SchemaType.ARRAY, "集合", true, Map.of(), item, List.of(), null, null, false);
        ApiDocument api = new ApiDocument("id-1", 1, "文档", "/api/oauth/orders/v1/query", "POST", List.of("orders"),
                schema, schema, List.of(), example, List.of(), ApiLifecycle.DEFAULT, null, false, "https://gateway.example.test", null);
        return new DocumentView("release-1", 1, "orders", "v1", "query", "订单", api);
    }
}
