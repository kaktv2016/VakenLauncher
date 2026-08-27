package com.helios.sso;

import com.google.gson.Gson;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Properties;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import net.neoforged.fml.loading.FMLPaths;

final class BridgeSubmitter {
    private static final String PATH = "/internal/sso/submit";
    private static final long RETRY_WINDOW_MILLIS = 55_000;
    private static final Gson GSON = new Gson();

    private BridgeSubmitter() {}

    static boolean submitWithRetry(String ticket, String serverId, String username, String uuid) {
        try {
            Configuration configuration = loadConfiguration();
            if(!configuration.serverId().equals(serverId)) {
                return false;
            }
            HttpClient client = createHttpClient(configuration);
            long deadline = System.currentTimeMillis() + RETRY_WINDOW_MILLIS;
            do {
                SubmitResult result = submitOnce(
                        client, configuration, ticket, serverId, username, uuid
                );
                if(result == SubmitResult.SUCCESS) {
                    return true;
                }
                if(result == SubmitResult.TERMINAL || System.currentTimeMillis() >= deadline) {
                    return false;
                }
                Thread.sleep(1_000);
            } while(!Thread.currentThread().isInterrupted());
            return false;
        } catch(Exception ignored) {
            // Never log a ticket, shared secret, signed request, or raw transport error.
            return false;
        }
    }

    private static SubmitResult submitOnce(
            HttpClient client,
            Configuration configuration,
            String ticket,
            String serverId,
            String username,
            String uuid
    ) {
        try {
            String body = GSON.toJson(new SsoRequest(ticket, serverId, username, uuid));
            String timestamp = Long.toString(System.currentTimeMillis());
            String nonce = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(uuidBytes(UUID.randomUUID()));
            String bodyHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(body.getBytes(StandardCharsets.UTF_8)));
            String canonical = timestamp + "\n" + nonce + "\nPOST\n" + PATH + "\n" + bodyHash;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(configuration.secret(), "HmacSHA256"));
            String signature = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
            HttpRequest request = HttpRequest.newBuilder(configuration.bridgeUri().resolve(PATH))
                    .timeout(Duration.ofSeconds(5))
                    .header("Content-Type", "application/json")
                    .header("X-Helios-Nonce", nonce)
                    .header("X-Helios-Signature", signature)
                    .header("X-Helios-Timestamp", timestamp)
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<Void> response = client.send(
                    request,
                    HttpResponse.BodyHandlers.discarding()
            );
            if(response.statusCode() == 200) {
                return SubmitResult.SUCCESS;
            }
            return response.statusCode() == 503
                    ? SubmitResult.RETRYABLE
                    : SubmitResult.TERMINAL;
        } catch(Exception ignored) {
            // Never log a ticket, shared secret, signed request, or raw transport error.
            return SubmitResult.RETRYABLE;
        }
    }

    private static Configuration loadConfiguration() throws Exception {
        Properties properties = new Properties();
        Path path = FMLPaths.CONFIGDIR.get().resolve("helios_sso.properties");
        try(var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            properties.load(reader);
        }
        URI bridgeUri = URI.create(properties.getProperty("bridgeUrl", ""));
        String serverId = properties.getProperty("serverId", "");
        byte[] secret = properties.getProperty("sharedSecret", "").getBytes(StandardCharsets.UTF_8);
        Path trustStorePath = Path.of(properties.getProperty("trustStorePath", ""))
                .toAbsolutePath().normalize();
        char[] trustStorePassword = properties.getProperty("trustStorePassword", "").toCharArray();
        if(!"https".equalsIgnoreCase(bridgeUri.getScheme())
                || bridgeUri.getUserInfo() != null
                || bridgeUri.getFragment() != null
                || serverId.isBlank()
                || serverId.length() > 128
                || secret.length < 32
                || trustStorePassword.length < 32
                || !Files.isRegularFile(trustStorePath)) {
            throw new IllegalArgumentException("Invalid Helios SSO server configuration.");
        }
        return new Configuration(bridgeUri, secret, serverId, trustStorePassword, trustStorePath);
    }

    private static HttpClient createHttpClient(Configuration configuration) throws Exception {
        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        try(var input = Files.newInputStream(configuration.trustStorePath())) {
            trustStore.load(input, configuration.trustStorePassword());
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

    private static byte[] uuidBytes(UUID value) {
        byte[] bytes = new byte[16];
        for(int index = 0; index < 8; index++) {
            bytes[index] = (byte) (value.getMostSignificantBits() >>> (56 - index * 8));
            bytes[index + 8] = (byte) (value.getLeastSignificantBits() >>> (56 - index * 8));
        }
        return bytes;
    }

    private record Configuration(
            URI bridgeUri,
            byte[] secret,
            String serverId,
            char[] trustStorePassword,
            Path trustStorePath
    ) {}
    private record SsoRequest(String ticket, String serverId, String username, String uuid) {}
    private enum SubmitResult { SUCCESS, RETRYABLE, TERMINAL }
}
