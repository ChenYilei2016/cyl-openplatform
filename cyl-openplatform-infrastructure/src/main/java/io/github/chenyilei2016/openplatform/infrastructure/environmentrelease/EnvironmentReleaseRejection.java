package io.github.chenyilei2016.openplatform.infrastructure.environmentrelease;

import io.github.chenyilei2016.openplatform.infrastructure.environmentrelease.EnvironmentReleaseSettings.RemoteTarget;
import java.util.Arrays;
import java.util.List;

/** 目标错误转换为受控指引；不透传未知远端正文、地址或凭据。 */
final class EnvironmentReleaseRejection {
    private static final String SCOPE_ERROR = "权限组不存在或已停用";

    private EnvironmentReleaseRejection() {}

    static String describe(RemoteTarget target, String action, int status, int code,
                           String reason, String requestId, List<String> requiredScopes) {
        String guidance;
        if (reason.equals(SCOPE_ERROR) || reason.startsWith(SCOPE_ERROR + "：")) {
            List<String> unavailable = reason.startsWith(SCOPE_ERROR + "：")
                    ? Arrays.asList(reason.substring(SCOPE_ERROR.length() + 1).split("、", -1)) : List.of();
            // 仅回显这份契约已声明的代码；旧目标只给通用原因时不冒称所有组均不可用。
            boolean specific = !unavailable.isEmpty() && unavailable.size() <= 100
                    && unavailable.stream().allMatch(requiredScopes::contains);
            guidance = specific ? "以下权限组不存在或已停用：" + codes(unavailable) + "。"
                    : "权限组不存在或已停用。" + (requiredScopes.isEmpty() ? "" : "本次需要核对：" + codes(requiredScopes) + "。");
            guidance += "请在目标环境的「权限组」按代码创建缺失的组或启用停用的组，再重新预览；跨环境发布不会自动创建权限组。";
        } else {
            guidance = switch (reason) {
                case "请选择已维护的有效分类；新分类请先在分类管理中创建" -> "分类尚未配置。请在目标环境「分类管理」创建同名分类，再重新预览。";
                case "请搜索并选择负责人，不能使用自由填写的名称" -> "负责人档案不可用。请重新选择目标负责人，再重新预览。";
                case "目标API已有待审申请，请先完成审核" -> "该 API 已有待审申请。请在目标环境处理原申请，再重新预览。";
                case "发布权限组不能为空" -> "固定快照没有权限组。请在来源 API 配置权限组并发布新快照，再选择新快照。";
                case "环境传输身份无效", "跨环境来源身份无效", "环境传输来源或目标不匹配" -> "跨环境身份校验未通过。请维护者核对两侧环境 ID、来源信任、机器凭据及代理请求头。";
                default -> switch (status) {
                    case 401, 403 -> "跨环境访问被拒绝。请维护者核对来源信任、机器凭据及目标访问策略。";
                    case 404 -> "目标入口或资源不存在。请核对目标部署版本和当前资源。";
                    case 409 -> "目标状态发生冲突。请检查目标待审申请与草稿状态，再重新预览。";
                    case 413 -> "传输内容超过目标允许的大小，请精简契约中的示例或文档后重新发布。";
                    case 429 -> "目标请求过于频繁，请稍后重试。";
                    default -> "契约校验未通过。请核对目标分类、负责人、权限组及服务绑定；仍无法处理时，将下方目标请求号交给维护者排查。";
                };
            };
        }
        String correlation = requestId.matches("[A-Za-z0-9._-]{1,128}") && !requestId.contains(target.credential())
                ? "；目标请求号：" + requestId : "";
        return ("目标「" + target.name() + "（" + target.id() + "）」拒绝" + action + "：" + guidance
                + "（目标 HTTP " + status + "，错误码 " + code + correlation + "）")
                .replace(target.credential(), "[已隐藏]");
    }

    private static String codes(List<String> values) {
        return String.join("、", values);
    }
}
