package io.github.chenyilei2016.openplatform.domain.runtime;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;

/** 单次调用的过程事实；原始值只交给授权管理视图，不进入异常消息或正式响应。 */
public final class InvocationDiagnostics {
    public enum Stage { AUTHORIZATION, REQUEST, TARGET, PROVIDER_AUTH, PROVIDER_CALL, BUSINESS, ADAPT, SCHEMA }
    public enum Status { PASSED, FAILED, NOT_CHECKED, UNAVAILABLE }
    public enum Outcome { SUCCEEDED, FAILED, UNKNOWN }
    public enum Dispatch { NOT_SENT, SENT, UNKNOWN }
    public record Check(Stage stage, Status status, String reason, String summary, List<ResponseAdaptation.Issue> issues) {}
    public record Capture(boolean available, Object value) {
        public static Capture missing() { return new Capture(false, null); }
        public static Capture of(Object value) { return new Capture(true, value); }
    }
    private final EnumMap<Stage, Check> checks = new EnumMap<>(Stage.class);
    private Capture mappedInput = Capture.missing();
    private Capture providerResponse = Capture.missing();
    private Capture adaptedData = Capture.missing();
    private Outcome outcome = Outcome.FAILED;
    private Dispatch dispatch = Dispatch.NOT_SENT;
    private Object data;
    private ErrorCode error;
    private String message;
    private String providerMessage;

    public void check(Stage stage, Status status, String reason, String summary, List<ResponseAdaptation.Issue> issues) {
        checks.put(stage, new Check(stage, status, reason, summary, List.copyOf(issues).stream().limit(20).toList()));
    }
    public void passed(Stage stage, String summary) { check(stage, Status.PASSED, null, summary, List.of()); }
    public List<Check> checks() {
        List<Check> result = new ArrayList<>();
        for (Stage stage : Stage.values()) result.add(checks.getOrDefault(stage,
                new Check(stage, Status.NOT_CHECKED, null, "尚未执行", List.of())));
        return result;
    }
    public void mapped(Object value) { mappedInput = Capture.of(value); }
    public void dispatch(Dispatch value) { dispatch = value; }
    public void received(Object value) { providerResponse = Capture.of(value); dispatch = Dispatch.SENT; }
    public void adapted(ResponseAdaptation.Result result) {
        if (result.succeeded() || result.issue().stage() == ResponseAdaptation.Stage.SCHEMA) adaptedData = Capture.of(result.adaptedData());
        providerMessage = result.providerMessage();
    }
    public void succeeded(Object value) { data = value; outcome = Outcome.SUCCEEDED; }
    public void failed(PlatformException failure) {
        error = failure.getErrorCode(); message = failure.getMessage();
        outcome = dispatch == Dispatch.UNKNOWN ? Outcome.UNKNOWN : Outcome.FAILED;
    }
    public Capture mappedInput() { return mappedInput; }
    public Capture providerResponse() { return providerResponse; }
    public Capture adaptedData() { return adaptedData; }
    public Outcome outcome() { return outcome; }
    public Dispatch providerDispatch() { return dispatch; }
    public Object data() { return data; }
    public ErrorCode error() { return error; }
    public String message() { return message; }
    public String providerMessage() { return providerMessage; }
}
