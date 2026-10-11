package io.github.chenyilei2016.openplatform.domain.common;

import java.util.ArrayList;
import java.util.List;

/** 定义校验的有界问题集合；路径为 JSON Pointer，不携带原始字段值。 */
public final class FieldValidation {
    public enum Reason { INVALID_VALUE, REQUIRED, TYPE_MISMATCH, INVALID_JSON, REFERENCE_UNAVAILABLE, IMMUTABLE }
    public record Issue(String path, Reason reason, String message) {}
    public record Problems(List<Issue> fieldIssues, boolean truncated) {
        public Problems { fieldIssues = List.copyOf(fieldIssues); }
    }
    public static final class Failure extends PlatformException {
        private final Problems problems;
        public Failure(Problems problems) {
            super(ErrorCode.INVALID_REQUEST, problems.fieldIssues().getFirst().message());
            this.problems = problems;
        }
        public Problems problems() { return problems; }
    }

    private static final int LIMIT = 50;
    private final List<Issue> issues = new ArrayList<>();
    private boolean truncated;

    public void check(boolean valid, String path, String message) {
        if (!valid) add(new Issue(path, Reason.INVALID_VALUE, message));
    }

    public void add(Issue issue) {
        if (issues.size() < LIMIT) issues.add(issue);
        else truncated = true;
    }

    /** 为嵌套规则补路径；依赖、身份和冲突错误必须保持原语义。 */
    public void inspect(String path, Runnable rule) {
        try { rule.run(); }
        catch (Failure failure) {
            for (Issue issue : failure.problems().fieldIssues())
                add(new Issue(path + issue.path(), issue.reason(), issue.message()));
            truncated |= failure.problems().truncated();
        } catch (PlatformException failure) {
            if (failure.getErrorCode() != ErrorCode.INVALID_REQUEST) throw failure;
            add(new Issue(path, Reason.INVALID_VALUE, failure.getMessage()));
        }
    }

    public Problems problems() { return new Problems(issues, truncated); }
    public boolean valid() { return issues.isEmpty(); }
    public void requireValid() { if (!valid()) throw new Failure(problems()); }
    public static Failure invalid(String path, Reason reason, String message) {
        return new Failure(new Problems(List.of(new Issue(path, reason, message)), false));
    }
    public static String segment(String value) { return value.replace("~", "~0").replace("/", "~1"); }
}
