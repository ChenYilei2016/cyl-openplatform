package io.github.chenyilei2016.openplatform.sdk;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.infrastructure.sdk.SdkZipArchiveReader;
import io.github.chenyilei2016.openplatform.web.shared.sdk.SdkTransferLimiter;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.CRC32;
import java.util.zip.ZipOutputStream;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.*;

class SdkArchiveReaderTest {
    private static final String MANIFEST = """
            {"format":"cyl-openplatform.sdk/v1","sdkVersion":"1.0.0","language":"JAVA",
             "gatewayProtocol":"HTTP_JSON_BEARER_V1","runtime":"Java 21+"}
            """;
    private final SdkZipArchiveReader reader = new SdkZipArchiveReader(JsonMapper.builder().build());

    @Test
    void readsRootManifestAndHashesOriginalBytes() throws Exception {
        byte[] archive = zip(Map.of("sdk-manifest.json", MANIFEST.getBytes(StandardCharsets.UTF_8),
                "src/OrderClient.java", "class OrderClient {}".getBytes(StandardCharsets.UTF_8)));
        var result = reader.read(new ByteArrayInputStream(archive));
        assertEquals("1.0.0", result.manifest().sdkVersion());
        assertEquals("JAVA", result.manifest().language());
        assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(archive)), result.sha256());
        assertArrayEquals(archive, result.content());
    }

    @Test
    void rejectsInvalidArchivesAndUnsafeOrRepeatedPaths() throws Exception {
        for (String path : new String[]{"../secret", "/etc/test", "C:/test", "src\\test", "src//test", "src/../test"}) {
            rejects(zip(Map.of("sdk-manifest.json", MANIFEST.getBytes(StandardCharsets.UTF_8), path, new byte[0])), ErrorCode.INVALID_REQUEST);
        }
        rejects("not zip".getBytes(StandardCharsets.UTF_8), ErrorCode.INVALID_REQUEST);
        rejects(zip(Map.of("readme.txt", new byte[0])), ErrorCode.INVALID_REQUEST);
        byte[] valid = zip(Map.of("sdk-manifest.json", MANIFEST.getBytes(StandardCharsets.UTF_8)));
        rejects(Arrays.copyOf(valid, valid.length - 22), ErrorCode.INVALID_REQUEST);
        byte[] duplicate = zip(Map.of("sdk-manifest.json", MANIFEST.getBytes(StandardCharsets.UTF_8), "sameA", new byte[0], "sameB", new byte[0]));
        for (int offset = 0; offset < duplicate.length - 4; offset++) {
            if (duplicate[offset] == 's' && duplicate[offset + 1] == 'a' && duplicate[offset + 2] == 'm'
                    && duplicate[offset + 3] == 'e' && duplicate[offset + 4] == 'B') duplicate[offset + 4] = 'A';
        }
        rejects(duplicate, ErrorCode.INVALID_REQUEST);
        var linkedBytes = new ByteArrayOutputStream();
        try (var zip = new ZipArchiveOutputStream(linkedBytes)) {
            zip.putArchiveEntry(new ZipArchiveEntry("sdk-manifest.json"));
            zip.write(MANIFEST.getBytes(StandardCharsets.UTF_8));
            zip.closeArchiveEntry();
            var link = new ZipArchiveEntry("linked-file");
            link.setUnixMode(0120777);
            zip.putArchiveEntry(link);
            zip.write("target".getBytes(StandardCharsets.UTF_8));
            zip.closeArchiveEntry();
        }
        rejects(linkedBytes.toByteArray(), ErrorCode.INVALID_REQUEST);
        var corruptedBytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(corruptedBytes)) {
            zip.putNextEntry(new ZipEntry("sdk-manifest.json"));
            zip.write(MANIFEST.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            byte[] text = "crc-check-payload".getBytes(StandardCharsets.UTF_8);
            var crc = new CRC32();
            crc.update(text);
            var entry = new ZipEntry("readme.txt");
            entry.setMethod(ZipEntry.STORED);
            entry.setSize(text.length);
            entry.setCrc(crc.getValue());
            zip.putNextEntry(entry);
            zip.write(text);
            zip.closeEntry();
        }
        byte[] corrupted = corruptedBytes.toByteArray();
        int payload = new String(corrupted, StandardCharsets.ISO_8859_1).indexOf("crc-check-payload");
        assertTrue(payload >= 0);
        corrupted[payload] = 'X';
        rejects(corrupted, ErrorCode.INVALID_REQUEST);
        var exception = assertThrows(PlatformException.class, () -> reader.read(new InputStream() {
            @Override public int read() throws IOException { throw new IOException("unavailable"); }
        }));
        assertEquals(ErrorCode.INVALID_REQUEST, exception.getErrorCode());
    }

    @Test
    void enforcesRawExpandedEntryAndManifestBudgets() throws Exception {
        rejects(new byte[2 * 1024 * 1024 + 1], ErrorCode.REQUEST_TOO_LARGE);
        rejects(zip(Map.of("sdk-manifest.json", MANIFEST.getBytes(StandardCharsets.UTF_8), "large.txt", new byte[8 * 1024 * 1024])), ErrorCode.REQUEST_TOO_LARGE);
        rejects(zip(Map.of("sdk-manifest.json", new byte[8 * 1024 + 1])), ErrorCode.REQUEST_TOO_LARGE);
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("sdk-manifest.json", MANIFEST.getBytes(StandardCharsets.UTF_8));
        for (int index = 0; index < 64; index++) entries.put("file-" + index, new byte[0]);
        rejects(zip(entries), ErrorCode.REQUEST_TOO_LARGE);
    }

    @Test
    void rejectsUnknownMissingCoercedAndUnsupportedManifestValues() throws Exception {
        for (String manifest : new String[]{MANIFEST.replace("Java 21+", ""), MANIFEST.replace("1.0.0", "../v1"),
                MANIFEST.replace("JAVA", "java"), MANIFEST.replace("HTTP_JSON_BEARER_V1", "DUBBO"),
                MANIFEST.replace("cyl-openplatform.sdk/v1", "other"), MANIFEST.replace("\"Java 21+\"", "21"),
                MANIFEST.replace("}", ",\"unknown\":true}"), MANIFEST.replace("\"runtime\":\"Java 21+\"", "\"other\":\"Java 21+\""),
                MANIFEST + "{}", MANIFEST.replace("}", ",\"language\":\"JAVA\"}")}) {
            rejects(zip(Map.of("sdk-manifest.json", manifest.getBytes(StandardCharsets.UTF_8))), ErrorCode.INVALID_REQUEST);
        }
    }

    @Test
    void limitsSharedTransfersAndReleasesPermitsAfterFailures() throws Exception {
        var limiter = new SdkTransferLimiter();
        var entered = new CountDownLatch(4);
        var finish = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var tasks = java.util.stream.IntStream.range(0, 4).mapToObj(index -> executor.submit(() -> limiter.execute(() -> {
                entered.countDown();
                try { assertTrue(finish.await(10, TimeUnit.SECONDS)); }
                catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new IllegalStateException(exception); }
                return index;
            }))).toList();
            try {
                assertTrue(entered.await(10, TimeUnit.SECONDS));
                assertEquals(ErrorCode.RATE_LIMITED, assertThrows(PlatformException.class, () -> limiter.execute(() -> "fifth")).getErrorCode());
            } finally { finish.countDown(); }
            for (var task : tasks) task.get(10, TimeUnit.SECONDS);
        }
        for (int index = 0; index < 8; index++) assertThrows(IllegalStateException.class, () -> limiter.execute(() -> { throw new IllegalStateException("failed"); }));
        assertEquals("available", limiter.execute(() -> "available"));
    }

    private void rejects(byte[] bytes, ErrorCode code) {
        assertEquals(code, assertThrows(PlatformException.class, () -> reader.read(new ByteArrayInputStream(bytes))).getErrorCode());
    }

    private static byte[] zip(Map<String, byte[]> entries) throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            for (var entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(entry.getValue());
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }
}
