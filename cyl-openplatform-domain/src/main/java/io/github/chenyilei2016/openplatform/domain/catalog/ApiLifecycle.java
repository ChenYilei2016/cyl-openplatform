package io.github.chenyilei2016.openplatform.domain.catalog;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.FieldValidation;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;

/** 对外版本的维护声明；计划退出日期不驱动定时停用，生效由发布快照决定。 */
public record ApiLifecycle(Status status, Compatibility compatibility, String compatibilityNotes,
                           String deprecationNotice, String replacementVersion, String sunsetDate) {
    public enum Status { ACTIVE, DEPRECATED, RETIRED }
    public enum Compatibility { UNSPECIFIED, COMPATIBLE, BREAKING }
    public static final ApiLifecycle DEFAULT = new ApiLifecycle(Status.ACTIVE, Compatibility.UNSPECIFIED, "", "", null, null);

    public ApiLifecycle {
        compatibilityNotes = compatibilityNotes == null ? "" : compatibilityNotes.strip();
        deprecationNotice = deprecationNotice == null ? "" : deprecationNotice.strip();
        replacementVersion = replacementVersion == null || replacementVersion.isBlank() ? null : replacementVersion;
        sunsetDate = sunsetDate == null || sunsetDate.isBlank() ? null : sunsetDate;
    }

    public void validate(String currentVersion) {
        if (status == null || compatibility == null) invalid("/status", "生命周期必须明确状态与兼容性声明");
        if (compatibilityNotes.length() > 2000 || deprecationNotice.length() > 2000) invalid("/compatibilityNotes", "兼容性与废弃说明不能超过2000字符");
        if (compatibility != Compatibility.UNSPECIFIED && compatibilityNotes.isBlank()) invalid("/compatibilityNotes", "兼容或不兼容声明必须填写说明");
        if (status != Status.ACTIVE && deprecationNotice.isBlank()) invalid("/deprecationNotice", "废弃或退役必须填写公告说明");
        if (status == Status.ACTIVE && (!deprecationNotice.isEmpty() || replacementVersion != null || sunsetDate != null))
            invalid("/status", "正常维护状态不能填写废弃公告、替代版本或计划退出日期");
        if (replacementVersion != null && (!replacementVersion.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}")
                || replacementVersion.equals(currentVersion))) invalid("/replacementVersion", "替代版本必须为不同的合法外部版本");
        if (sunsetDate != null) {
            if (!sunsetDate.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) invalid("/sunsetDate", "计划退出日期必须是有效YYYY-MM-DD日期");
            try { LocalDate.parse(sunsetDate); }
            catch (DateTimeParseException invalidDate) { invalid("/sunsetDate", "计划退出日期必须是有效YYYY-MM-DD日期"); }
        }
    }

    /** 领域判断不是JSON属性；避免序列化成额外的default字段。 */
    @java.beans.Transient
    public boolean isDefault() { return equals(DEFAULT); }

    /** 在可信Token和scope验证之后执行，避免泄漏未授权API状态。 */
    public void requireCallable() {
        if (status == Status.RETIRED) throw new PlatformException(ErrorCode.API_RETIRED, ErrorCode.API_RETIRED.getMessage());
    }

    private static void invalid(String path, String message) { throw FieldValidation.invalid(path, FieldValidation.Reason.INVALID_VALUE, message); }
}
