package io.github.chenyilei2016.openplatform.web.page;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class AdminPageController {
    /** 入口页每次向服务端确认（仍可用 Last-Modified 协商）；发布后浏览器不会继续用旧入口去引用已删除的带哈希 chunk。 */
    private static final String ENTRY_CACHE = CacheControl.noCache().getHeaderValue();

    @GetMapping("/")
    public String home() {
        return "redirect:/portal/";
    }

    @GetMapping("/admin")
    public String redirectToAdmin() {
        return "redirect:/admin/";
    }

    @GetMapping("/admin/")
    public String adminPage(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, ENTRY_CACHE);
        return "forward:/admin/index.html";
    }
    /** 共用门户产物，原文档地址保留独立业务 Token 授权阅读。 */
    @GetMapping({"/docs", "/docs/"})
    public String documents(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, ENTRY_CACHE);
        return "forward:/portal/index.html";
    }

    /** 门户使用独立静态产物，操作API仍须客户会话和资格验证。 */
    @GetMapping({"/portal", "/portal/"})
    public String portal(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, ENTRY_CACHE);
        return "forward:/portal/index.html";
    }
}
