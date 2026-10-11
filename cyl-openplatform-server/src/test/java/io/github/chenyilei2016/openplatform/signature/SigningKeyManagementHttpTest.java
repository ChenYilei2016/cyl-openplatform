package io.github.chenyilei2016.openplatform.signature;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import io.github.chenyilei2016.openplatform.application.signature.SigningKeyService;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import io.github.chenyilei2016.openplatform.domain.signature.SigningKeyRepository;
import io.github.chenyilei2016.openplatform.infrastructure.signature.dal.dataobject.SigningKeyDO;
import io.github.chenyilei2016.openplatform.infrastructure.signature.dal.mapper.SigningKeyMapper;

import io.github.chenyilei2016.openplatform.application.identity.AccountAuthentication;
import io.github.chenyilei2016.openplatform.testing.TestAccount;
import jakarta.servlet.http.Cookie;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@io.github.chenyilei2016.openplatform.testing.TestAdministrators
@SpringBootTest(properties = {

    "test.admin.operators[0].tenant-id=tenant-1",
    "test.admin.operators[0].employee-no=operator-1",
    "test.admin.operators[0].permissions[0]=MANAGE_APPLICATIONS",
    "open-platform.signature.active-wrapping-key-id=local-test",
    "open-platform.signature.wrapping-keys.local-test=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
})
@AutoConfigureMockMvc(print = org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
class SigningKeyManagementHttpTest {
    @Autowired MockMvc mvc;
    @Autowired SigningKeyRepository keys;
    @Autowired SigningKeyService service;
    @Autowired SigningKeyMapper mapper;
    @MockitoBean AccountAuthentication identityService;
    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach void identity() {
        var user = new TestAccount(); user.setId(1L); user.setTenantId("tenant-1"); user.setEmployeeNoStr("operator-1");
        when(identityService.current("test-session")).thenAnswer(invocation -> user.toAccount());
        var other = new TestAccount(); other.setId(2L); other.setTenantId("tenant-1"); other.setEmployeeNoStr("unprivileged");
        when(identityService.current("other-session")).thenAnswer(invocation -> other.toAccount());
    }

    @Test void lifecycleIsVersionedEncryptedOneTimeAndAuditedWithoutChangingAuthorization() throws Exception {
        String id = createApplication(); String path = "/admin-api/applications/" + id + "/signing-key";
        String before = mvc.perform(auth(get("/admin-api/applications/" + id))).andReturn().getResponse().getContentAsString();
        mvc.perform(auth(get(path))).andExpect(status().isOk()).andExpect(jsonPath("$.data.configured").value(true)).andExpect(jsonPath("$.data.key").isEmpty());
        var issued = response(auth(post(path).content("{\"expectedRevision\":0}")));
        String secret = issued.at("/data/signingSecret").asText();
        String keyId = issued.at("/data/key/keyId").asText();
        assertThat(secret).matches("[A-Za-z0-9_-]{43}"); assertThat(keyId).matches("[a-f0-9]{32}");
        assertThat(mapper.selectById(id).getEncryptedSecret()).startsWith("v1:").doesNotContain(secret);
        var original = keys.findByKeyId(keyId).orElseThrow();
        assertThat(service.requireSecret(original)).isEqualTo(Base64.getUrlDecoder().decode(secret));
        String detail = mvc.perform(auth(get(path))).andExpect(header().string("Cache-Control", "no-store")).andReturn().getResponse().getContentAsString();
        assertThat(detail).doesNotContain(secret, "signingSecret", "encryptedSecret", "wrappingKeyId");
        mvc.perform(auth(post(path).content("{\"expectedRevision\":1}"))).andExpect(status().isConflict());
        mvc.perform(auth(post(path + "/rotate").content("{\"expectedRevision\":0}"))).andExpect(status().isConflict());
        var rotated = response(auth(post(path + "/rotate").content("{\"expectedRevision\":1}")));
        assertThat(rotated.at("/data/key/keyId").asText()).isNotEqualTo(keyId);
        assertThat(rotated.at("/data/signingSecret").asText()).isNotEqualTo(secret);
        assertThat(keys.findByKeyId(keyId)).isEmpty();
        assertThatThrownBy(() -> service.requireSecret(original)).isInstanceOf(PlatformException.class);
        mvc.perform(auth(post(path + "/revoke").content("{\"expectedRevision\":2}"))).andExpect(status().isOk()).andExpect(jsonPath("$.data.revision").value(3));
        assertThat(mapper.selectById(id).getEncryptedSecret()).isNull(); assertThat(mapper.selectById(id).getWrappingKeyId()).isNull();
        mvc.perform(auth(post(path + "/revoke").content("{\"expectedRevision\":2}"))).andExpect(status().isConflict());
        mvc.perform(auth(post(path + "/revoke").content("{\"expectedRevision\":3}"))).andExpect(status().isOk()).andExpect(jsonPath("$.data.revision").value(3));
        mvc.perform(auth(post(path + "/rotate").content("{\"expectedRevision\":3}"))).andExpect(status().isConflict());
        response(auth(post(path).content("{\"expectedRevision\":3}")));
        String after = mvc.perform(auth(get("/admin-api/applications/" + id))).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(after).at("/data/authorizationVersion")).isEqualTo(json.readTree(before).at("/data/authorizationVersion"));
        String audit = mvc.perform(auth(get("/admin-api/applications/" + id + "/audit"))).andReturn().getResponse().getContentAsString();
        assertThat(audit).contains("CREATE_SIGNING_KEY", "ROTATE_SIGNING_KEY", "REVOKE_SIGNING_KEY").doesNotContain(secret, "encryptedSecret");
    }

    @Test void strictRevisionPermissionsAndCsrfAreEnforced() throws Exception {
        String path = "/admin-api/applications/" + createApplication() + "/signing-key";
        for (String invalid : java.util.List.of("-1", "1.5", "\"0\"", "null", "9007199254740991", "9223372036854775808"))
            mvc.perform(auth(post(path).content("{\"expectedRevision\":" + invalid + "}"))).andExpect(status().isBadRequest());
        mvc.perform(auth(post(path).content("{\"expectedRevision\":0,\"signingSecret\":\"client-choice\"}"))).andExpect(status().isBadRequest());
        mvc.perform(post(path).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).contentType("application/json").content("{\"expectedRevision\":0}"))
                .andExpect(status().isForbidden());
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(get(path).session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("other-session"))).andExpect(status().isForbidden());
    }

    @Test void modifiedCiphertextAndCrossApplicationCopyCannotBeDecrypted() throws Exception {
        String first = createApplication(), second = createApplication();
        response(auth(post("/admin-api/applications/" + first + "/signing-key").content("{\"expectedRevision\":0}")));
        response(auth(post("/admin-api/applications/" + second + "/signing-key").content("{\"expectedRevision\":0}")));
        var row = mapper.selectById(first);
        mapper.update(null, new LambdaUpdateWrapper<SigningKeyDO>().eq(SigningKeyDO::getApplicationId, second)
                .set(SigningKeyDO::getEncryptedSecret, row.getEncryptedSecret()));
        assertThatThrownBy(() -> service.requireSecret(keys.findByApplication(second).orElseThrow())).isInstanceOf(PlatformException.class);
        String ciphertext = row.getEncryptedSecret();
        String changed = ciphertext.substring(0, 20) + (ciphertext.charAt(20) == 'A' ? 'B' : 'A') + ciphertext.substring(21);
        mapper.update(null, new LambdaUpdateWrapper<SigningKeyDO>().eq(SigningKeyDO::getApplicationId, first).set(SigningKeyDO::getEncryptedSecret, changed));
        assertThatThrownBy(() -> service.requireSecret(keys.findByApplication(first).orElseThrow())).isInstanceOf(PlatformException.class);
    }

    private String createApplication() throws Exception {
        return response(auth(post("/admin-api/applications").content("{\"name\":\"签名测试应用\",\"ownerTenantId\":\"101\"}"))).at("/data/application/id").asText();
    }
    private JsonNode response(MockHttpServletRequestBuilder request) throws Exception {
        return json.readTree(mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    private MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.session(io.github.chenyilei2016.openplatform.testing.TestSessions.session("test-session")).header("X-CSRF-Token", "76832d7fdbcdbf4a72129f8b7def9016").contentType("application/json");
    }
}
