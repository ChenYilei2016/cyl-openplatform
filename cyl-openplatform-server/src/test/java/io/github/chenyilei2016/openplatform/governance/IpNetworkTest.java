package io.github.chenyilei2016.openplatform.governance;

import io.github.chenyilei2016.openplatform.domain.governance.IpNetwork;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class IpNetworkTest {
    @Test void canonicalPrefixesKeepIpv4AndIpv6BoundariesAndAddressFamilies() {
        var ipv4 = IpNetwork.parse("192.168.7.123/24");
        assertThat(ipv4.toString()).isEqualTo("192.168.7.0/24");
        assertThat(ipv4.contains("192.168.7.255")).isTrue();
        assertThat(ipv4.contains("192.168.8.0")).isFalse();
        assertThat(IpNetwork.parse("0.0.0.0/0").contains("255.255.255.255")).isTrue();
        assertThat(IpNetwork.parse("::/0").contains("ffff::1")).isTrue();
        assertThat(IpNetwork.parse("::/0").contains("127.0.0.1")).isFalse();
        assertThat(IpNetwork.parse("2001:db8::1/64").contains("2001:db8::ffff")).isTrue();
        assertThat(IpNetwork.parse("2001:db8::1/64").contains("2001:db8:1::")).isFalse();
        assertThat(IpNetwork.parse("::1").contains("::1")).isTrue();
        for(String value : new String[]{"example.com/24", "127.0.0.1/33", "::1/129", "::1%lo0/64", "127.0.0.1/-1", "127.0.0.1/1/2"})
            assertThatThrownBy(() -> IpNetwork.parse(value)).isInstanceOf(RuntimeException.class);
    }
}
