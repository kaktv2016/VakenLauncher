package com.helios.authbridge;

import com.google.gson.Gson;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

final class BackendClient {
    private static final String CONSUME_PATH = "/internal/sso/consume";
    private final URI baseUri;
    private final Clock clock;
    private final Gson gson = new Gson();
    private final HttpClient httpClient;
    private final byte[] secret;

    BackendClient(String baseUrl, String sharedSecret) {
        this(baseUrl, sharedSecret, Clock.systemUTC(), HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build());
    }

    BackendClient(String baseUrl, String sharedSecret, Path trustStorePath, char[] trustStorePassword)
            throws Exception {
        this(baseUrl, sharedSecret, Clock.systemUTC(), createHttpClient(trustStorePath, trustStorePassword));
    }

    BackendClient(String baseUrl, String sharedSecret, Clock clock, HttpClient httpClient) {
        this.baseUri = URI.create(baseUrl);
        if(!"https".equalsIgnoreCase(baseUri.getScheme())
                || baseUri.getUserInfo() != null
                || baseUri.getFragment() != null) {
            throw new IllegalArgumentException("The Helios backend URL must be a clean HTTPS URL.");
        }
        this.secret = sharedSecret.getBytes(StandardCharsets.UTF_8);
        if(this.secret.length < 32) {
            throw new IllegalArgumentException("The backend shared secret must contain at least 32 bytes.");
        }
        this.clock = clock;
        this.httpClient = httpClient;
    }

    boolean consume(SsoRequest request) {
        try {
            String serialized = gson.toJson(request);
            String timestamp = Long.toString(clock.millis());
            String nonce = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(randomNonce());
            String bodyHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(serialized.getBytes(StandardCharsets.UTF_8)));
            String canonical = timestamp + "\n" + nonce + "\nPOST\n" + CONSUME_PATH + "\n" + bodyHash;
            String signature = Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(canonical));
            HttpRequest httpRequest = HttpRequest.newBuilder(baseUri.resolve(CONSUME_PATH))
                    .timeout(Duration.ofSeconds(5))
                    .header("Content-Type", "application/json")
                    .header("X-Helios-Nonce", nonce)
                    .header("X-Helios-Signature", signature)
                    .header("X-Helios-Timestamp", timestamp)
                    .POST(HttpRequest.BodyPublishers.ofString(serialized, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = httpClient.send(
                    httpRequest,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            return response.statusCode() == 200
                    && Boolean.TRUE.equals(gson.fromJson(response.body(), BackendResponse.class).ok());
        } catch(Exception ignored) {
            return false;
        }
    }

    private byte[] hmac(String canonical) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        return mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8));
    }

    private static HttpClient createHttpClient(Path trustStorePath, char[] trustStorePassword)
            throws Exception {
        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        try(InputStream input = Files.newInputStream(trustStorePath)) {
            trustStore.load(input, trustStorePassword);
        }
        TrustManagerFactory trustManagers = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
        );
        trustManagers.init(trustStore);
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, trustManagers.getTrustManagers(), null);
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .sslContext(sslContext)
                .build();
    }

    private static byte[] randomNonce() {
        UUID value = UUID.randomUUID();
        byte[] bytes = new byte[16];
        for(int index = 0; index < 8; index++) {
            bytes[index] = (byte) (value.getMostSignificantBits() >>> (56 - index * 8));
            bytes[index + 8] = (byte) (value.getLeastSignificantBits() >>> (56 - index * 8));
        }
        return bytes;
    }

    record SsoRequest(String ticket, String serverId, String username, String uuid) {}
    private record BackendResponse(Boolean ok) {}
}
