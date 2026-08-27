package com.helios.authbridge;

import com.sun.net.httpserver.Headers;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

final class RequestAuthenticator {
    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final int MIN_SECRET_BYTES = 32;
    private final Clock clock;
    private final long clockSkewMillis;
    private final byte[] secret;
    private final Map<String, Long> usedNonces = new ConcurrentHashMap<>();

    RequestAuthenticator(String secret, long clockSkewSeconds, Clock clock) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        if(this.secret.length < MIN_SECRET_BYTES) {
            throw new IllegalArgumentException("The bridge shared secret must contain at least 32 bytes.");
        }
        if(clockSkewSeconds < 1 || clockSkewSeconds > 300) {
            throw new IllegalArgumentException("Request clock skew must be between 1 and 300 seconds.");
        }
        this.clockSkewMillis = clockSkewSeconds * 1000L;
        this.clock = clock;
    }

    boolean verify(String method, String path, byte[] body, Headers headers) {
        String timestampValue = headers.getFirst("X-Helios-Timestamp");
        String nonce = headers.getFirst("X-Helios-Nonce");
        String signature = headers.getFirst("X-Helios-Signature");
        if(timestampValue == null || nonce == null || signature == null
                || !nonce.matches("[A-Za-z0-9_-]{20,128}")) {
            return false;
        }

        long timestamp;
        try {
            timestamp = Long.parseLong(timestampValue);
        } catch(NumberFormatException ignored) {
            return false;
        }
        long now = clock.millis();
        if(Math.abs(now - timestamp) > clockSkewMillis) {
            return false;
        }

        String bodyHash = HexFormat.of().formatHex(sha256(body));
        String canonical = timestampValue + "\n" + nonce + "\n" + method + "\n" + path + "\n" + bodyHash;
        byte[] expected = hmac(canonical.getBytes(StandardCharsets.UTF_8));
        byte[] actual;
        try {
            actual = Base64.getUrlDecoder().decode(signature);
        } catch(IllegalArgumentException ignored) {
            return false;
        }
        if(actual.length != expected.length || !MessageDigest.isEqual(expected, actual)) {
            return false;
        }

        usedNonces.entrySet().removeIf(entry -> now - entry.getValue() > clockSkewMillis);
        return usedNonces.putIfAbsent(nonce, now) == null;
    }

    private byte[] hmac(byte[] input) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(secret, HMAC_ALGORITHM));
            return mac.doFinal(input);
        } catch(Exception exception) {
            throw new IllegalStateException("Unable to calculate request signature.", exception);
        }
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch(Exception exception) {
            throw new IllegalStateException("Unable to calculate request digest.", exception);
        }
    }
}
