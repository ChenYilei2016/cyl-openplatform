package io.github.chenyilei2016.openplatform.domain.governance;

import io.github.chenyilei2016.openplatform.domain.common.ErrorCode;
import io.github.chenyilei2016.openplatform.domain.common.PlatformException;
import java.net.InetAddress;
import java.net.UnknownHostException;

/** 字面IP或CIDR；全程不解析DNS，统一网络地址后比较同一地址族的前缀位。 */
public final class IpNetwork {
    private final byte[] network;
    private final int prefix;
    private final String canonical;

    private IpNetwork(byte[] network, int prefix, String canonical) {
        this.network = network; this.prefix = prefix; this.canonical = canonical;
    }

    public static IpNetwork parse(String value) {
        try {
            if (value == null || value.length() > 49 || value.contains("%")) throw new IllegalArgumentException();
            String[] parts = value.split("/", -1);
            if (parts.length > 2) throw new IllegalArgumentException();
            byte[] bytes = InetAddress.ofLiteral(parts[0]).getAddress();
            int prefix = bytes.length * 8;
            if (parts.length == 2) {
                if (!parts[1].matches("[0-9]{1,3}")) throw new IllegalArgumentException();
                prefix = Integer.parseInt(parts[1]);
                if (prefix > bytes.length * 8) throw new IllegalArgumentException();
            }
            for (int i = 0; i < bytes.length; i++) {
                int bits = Math.min(8, Math.max(0, prefix - i * 8));
                bytes[i] = (byte) (bytes[i] & (0xff << (8 - bits)));
            }
            String canonical = InetAddress.getByAddress(bytes).getHostAddress() + (parts.length == 2 ? "/" + prefix : "");
            return new IpNetwork(bytes, prefix, canonical);
        } catch (IllegalArgumentException | UnknownHostException failure) {
            throw new PlatformException(ErrorCode.INVALID_REQUEST, "IP名单只能包含有效IPv4/IPv6字面地址或CIDR");
        }
    }

    public boolean contains(String literal) {
        byte[] address = InetAddress.ofLiteral(literal).getAddress();
        if (address.length != network.length) return false;
        for (int i = 0; i < address.length; i++) {
            int bits = Math.min(8, Math.max(0, prefix - i * 8));
            int mask = 0xff & (0xff << (8 - bits));
            if ((address[i] & mask) != (network[i] & mask)) return false;
        }
        return true;
    }

    @Override public String toString() { return canonical; }
}
