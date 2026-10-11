package io.github.chenyilei2016.openplatform.domain.documentation;

public enum DocumentFormat {
    JSON("json", "application/json"), HTML("html", "text/html;charset=UTF-8");
    private final String extension;
    private final String mediaType;
    DocumentFormat(String extension, String mediaType) { this.extension=extension; this.mediaType=mediaType; }
    public String extension() { return extension; }
    public String mediaType() { return mediaType; }
}
