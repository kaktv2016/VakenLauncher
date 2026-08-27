package com.helios.authbridge;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.Headers;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

class RequestAuthenticatorTest {
    private static final String SECRET = "test-shared-secret-containing-at-least-32-bytes";
    private static final long NOW = 1_800_000_000_000L;
    private static final byte[] BODY = "{\"username\":\"LocalPlayer\"}".getBytes(StandardCharsets.UTF_8);

    @Test
    void acceptsOneValidSignedRequestAndRejectsReplay() throws Exception {
        RequestAuthenticator authenticator = authenticator();
        Headers headers = signedHeaders(NOW, "abcdefghijklmnopqrstuvwxyz123456", BODY);
        assertTrue(authenticator.verify("POST", "/internal/auth/login", BODY, headers));
        assertFalse(authenticator.verify("POST", "/internal/auth/login", BODY, headers));
    }

    @Test
    void rejectsExpiredTamperedAndWrongPathRequests() throws Exception {
        RequestAuthenticator authenticator = authenticator();
        assertFalse(authenticator.verify(
                "POST",
                "/internal/auth/login",
                BODY,
                signedHeaders(NOW - 31_000, "expirednonceabcdefghijkl", BODY)
        ));
        assertFalse(authenticator.verify(
                "POST",
                "/internal/auth/login",
                "tampered".getBytes(StandardCharsets.UTF_8),
                signedHeaders(NOW, "tamperednonceabcdefghijk", BODY)
        ));
        assertFalse(authenticator.verify(
                "POST",
                "/internal/auth/register",
                BODY,
                signedHeaders(NOW, "wrongpathnonceabcdefghij", BODY)
        ));
    }

    @Test
    void acceptsTheSharedNodeJavaProtocolVector() {
        byte[] body = "{\"ticket\":\"opaque-ticket\",\"serverId\":\"youer-main\"}"
                .getBytes(StandardCharsets.UTF_8);
        Headers headers = new Headers();
        headers.set("X-Helios-Timestamp", "1800000000000");
        headers.set("X-Helios-Nonce", "crosslanguagevectornonce12345");
        headers.set("X-Helios-Signature", "rZGRqw1txBNc6Er3vc9M4zYVsZDu9JqwxgiFx6RUcTo");
        assertTrue(authenticator().verify("POST", "/internal/sso/consume", body, headers));
    }

    @Test
    void backendClientFailsClosedWhenBackendIsUnavailable() {
        BackendClient client = new BackendClient("https://127.0.0.1:1", SECRET);
        assertFalse(client.consume(new BackendClient.SsoRequest(
                "opaque-ticket-containing-at-least-thirty-two-bytes",
                "youer-main",
                "LocalPlayer",
                "00000000-0000-0000-0000-000000000001"
        )));
    }

    private RequestAuthenticator authenticator() {
        return new RequestAuthenticator(
                SECRET,
                30,
                Clock.fixed(Instant.ofEpochMilli(NOW), ZoneOffset.UTC)
        );
    }

    private Headers signedHeaders(long timestamp, String nonce, byte[] body) throws Exception {
        String bodyHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        String canonical = timestamp + "\n" + nonce + "\nPOST\n/internal/auth/login\n" + bodyHash;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        Headers headers = new Headers();
        headers.set("X-Helios-Timestamp", Long.toString(timestamp));
        headers.set("X-Helios-Nonce", nonce);
        headers.set("X-Helios-Signature", Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(
                canonical.getBytes(StandardCharsets.UTF_8)
        )));
        return headers;
    }
}
