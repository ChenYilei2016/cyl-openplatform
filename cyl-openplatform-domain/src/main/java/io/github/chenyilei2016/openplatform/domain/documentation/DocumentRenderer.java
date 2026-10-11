package io.github.chenyilei2016.openplatform.domain.documentation;

public interface DocumentRenderer {
    ExportedDocument render(DocumentView document, DocumentFormat format);
    record ExportedDocument(String filename, String mediaType, byte[] bytes) {}
}
