package io.github.chenyilei2016.openplatform.infrastructure.sdk;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.sdk.SdkArchive;
import io.github.chenyilei2016.openplatform.domain.sdk.SdkArchiveReader;
import io.github.chenyilei2016.openplatform.domain.sdk.SdkManifest;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.zip.CRC32;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.apache.commons.compress.utils.SeekableInMemoryByteChannel;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectReader;
import tools.jackson.databind.json.JsonMapper;

/** 仅读取和验证小型单卷ZIP；内容仍是不受信任的下载资产，不在服务端执行。 */
@Component
public class SdkZipArchiveReader implements SdkArchiveReader {
    private static final int MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
    private static final int MAX_ENTRIES = 64;
    private static final int MAX_MANIFEST_BYTES = 8 * 1024;
    private static final String MANIFEST_PATH = "sdk-manifest.json";
    private static final Set<String> MANIFEST_FIELDS = Set.of("format", "sdkVersion", "language", "gatewayProtocol", "runtime");
    private final ObjectReader manifestReader;

    public SdkZipArchiveReader(JsonMapper json) {
        manifestReader = json.rebuild().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build()
                .readerFor(Object.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    @Override
    public SdkArchive read(InputStream input) {
        try {
            byte[] content = input.readNBytes(SdkArchive.MAX_CONTENT_BYTES + 1);
            if (content.length > SdkArchive.MAX_CONTENT_BYTES) throw tooLarge();
            var paths = new HashSet<String>();
            byte[] manifest = null;
            int expanded = 0;
            try (var zip = ZipFile.builder().setSeekableByteChannel(new SeekableInMemoryByteChannel(content)).get()) {
                byte[] buffer = new byte[8192];
                var entries = zip.getEntries();
                int count = 0;
                while (entries.hasMoreElements()) {
                    if (++count > MAX_ENTRIES) throw tooLarge();
                    var entry = entries.nextElement();
                    // FAT条目会把反斜杠静默规范成正斜杠，必须在名称规范化之外核验原始名称。
                    for (byte value : entry.getRawName()) if (value == '\\') throw invalid();
                    String name = entry.getName();
                    String path = entry.isDirectory() ? name.substring(0, name.length() - 1) : name;
                    if (path.isEmpty() || path.startsWith("/") || path.contains("\\") || path.contains(":")
                            || path.chars().anyMatch(Character::isISOControl) || !paths.add(path)
                            || entry.isUnixSymlink() || !zip.canReadEntryData(entry)) throw invalid();
                    for (String segment : path.split("/", -1)) {
                        if (segment.isBlank() || segment.equals("..") || segment.equals(".")) throw invalid();
                    }
                    var manifestBytes = MANIFEST_PATH.equals(name) ? new ByteArrayOutputStream(1024) : null;
                    var crc = new CRC32();
                    int entryBytes = 0;
                    try (var stream = zip.getInputStream(entry)) {
                        for (int length; (length = stream.read(buffer)) != -1;) {
                            expanded += length;
                            entryBytes += length;
                            if (expanded > MAX_EXPANDED_BYTES) throw tooLarge();
                            crc.update(buffer, 0, length);
                            if (manifestBytes != null) {
                                if (manifestBytes.size() + length > MAX_MANIFEST_BYTES) throw tooLarge();
                                manifestBytes.write(buffer, 0, length);
                            }
                        }
                    }
                    if (entryBytes != entry.getSize() || crc.getValue() != entry.getCrc()) throw invalid();
                    if (manifestBytes != null) manifest = manifestBytes.toByteArray();
                }
            }
            if (manifest == null) throw invalid();
            SdkManifest declaration = readManifest(manifest);
            return new SdkArchive(declaration, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)), content);
        } catch (IOException | IllegalArgumentException failure) {
            throw invalid();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private SdkManifest readManifest(byte[] bytes) {
        try {
            Object value = manifestReader.readValue(bytes);
            if (!(value instanceof Map<?, ?> fields) || !fields.keySet().equals(MANIFEST_FIELDS)
                    || fields.values().stream().anyMatch(field -> !(field instanceof String))) throw invalid();
            var manifest = new SdkManifest((String) fields.get("format"), (String) fields.get("sdkVersion"),
                    (String) fields.get("language"), (String) fields.get("gatewayProtocol"), (String) fields.get("runtime"));
            if (!"cyl-openplatform.sdk/v1".equals(manifest.format())
                    || !manifest.sdkVersion().matches("[A-Za-z0-9][A-Za-z0-9._-]{0,31}")
                    || !manifest.language().matches("[A-Z][A-Z0-9_]{0,31}")
                    || !"HTTP_JSON_BEARER_V1".equals(manifest.gatewayProtocol())
                    || manifest.runtime().isBlank() || manifest.runtime().length() > 80) throw invalid();
            return manifest;
        } catch (RuntimeException failure) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "SDK根清单字段、格式或声明不合法");
        }
    }

    private static PlatformException invalid() {
        return new PlatformException(ErrorCode.INVALID_REQUEST, "SDK必须是完整、无重复或危险路径的ZIP，并包含根清单");
    }

    private static PlatformException tooLarge() {
        return new PlatformException(ErrorCode.REQUEST_TOO_LARGE, "SDK ZIP超出原始大小、展开大小、清单大小或条目数量限制");
    }
}
