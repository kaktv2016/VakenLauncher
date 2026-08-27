package com.helios.authbridge;

import com.google.gson.Gson;
import com.google.gson.JsonParseException;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import fr.xephi.authme.api.v3.AuthMeApi;
import fr.xephi.authme.api.v3.AuthMePlayer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Clock;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

final class BridgeHttpServer {
    private static final long AUTHME_CONFIRMATION_TIMEOUT_MILLIS = 4_000;
    private static final long AUTHME_POLL_INTERVAL_MILLIS = 100;
    private static final int MAX_BODY_BYTES = 16 * 1024;
    private static final String JSON_CONTENT_TYPE = "application/json; charset=utf-8";
    private final Gson gson = new Gson();
    private final HttpsServer server;
    private final RequestAuthenticator authenticator;
    private final BackendClient backendClient;
    private final JavaPlugin plugin;

    BridgeHttpServer(
            String bindAddress,
            int port,
            Path keyStorePath,
            char[] keyStorePassword,
            String sharedSecret,
            long clockSkewSeconds,
            String backendUrl,
            Path backendTrustStorePath,
            char[] backendTrustStorePassword,
            JavaPlugin plugin
    ) throws Exception {
        InetAddress address = InetAddress.getByName(bindAddress);
        if(!address.isLoopbackAddress()) {
            throw new IllegalArgumentException("The AuthMe bridge must bind to a loopback address.");
        }
        this.authenticator = new RequestAuthenticator(sharedSecret, clockSkewSeconds, Clock.systemUTC());
        this.backendClient = new BackendClient(
                backendUrl,
                sharedSecret,
                backendTrustStorePath,
                backendTrustStorePassword
        );
        this.plugin = plugin;
        this.server = HttpsServer.create(new InetSocketAddress(address, port), 0);
        this.server.setHttpsConfigurator(new HttpsConfigurator(createSslContext(keyStorePath, keyStorePassword)));
        this.server.createContext("/internal/auth/login", this::handleLogin);
        this.server.createContext("/internal/auth/register", this::handleRegister);
        this.server.createContext("/internal/sso/submit", this::handleSso);
        this.server.setExecutor(Executors.newFixedThreadPool(4, runnable -> {
            Thread thread = new Thread(runnable, "helios-authme-bridge");
            thread.setDaemon(true);
            return thread;
        }));
    }

    void start() {
        server.start();
    }

    void stop() {
        server.stop(1);
    }

    private void handleLogin(HttpExchange exchange) throws IOException {
        AuthRequest request = authenticateAndParse(exchange);
        if(request == null) {
            return;
        }
        AuthMeApi api = AuthMeApi.getInstance();
        if(api == null || !isValid(request) || !api.isRegistered(request.username())
                || !api.checkPassword(request.username(), request.password())) {
            send(exchange, 401, new AuthResponse(false, null));
            return;
        }
        Optional<AuthMePlayer> player = api.getPlayerInfo(request.username());
        String canonicalName = player.map(AuthMePlayer::getName).orElse(request.username());
        send(exchange, 200, new AuthResponse(true, canonicalName));
    }

    private void handleRegister(HttpExchange exchange) throws IOException {
        AuthRequest request = authenticateAndParse(exchange);
        if(request == null) {
            return;
        }
        AuthMeApi api = AuthMeApi.getInstance();
        if(api == null || !isValid(request) || api.isRegistered(request.username())
                || !api.registerPlayer(request.username(), request.password())) {
            send(exchange, 409, new AuthResponse(false, null));
            return;
        }
        send(exchange, 200, new AuthResponse(true, request.username()));
    }

    private void handleSso(HttpExchange exchange) throws IOException {
        SsoRequest request = authenticateAndParse(exchange, SsoRequest.class);
        if(request == null) {
            return;
        }
        if(!isValid(request)) {
            send(exchange, 401, new ErrorResponse("AUTHENTICATION_FAILED"));
            return;
        }
        SyncResult playerMatch = playerMatches(request);
        if(playerMatch == SyncResult.UNAVAILABLE) {
            send(exchange, 503, new ErrorResponse("SERVICE_UNAVAILABLE"));
            return;
        }
        if(playerMatch != SyncResult.SUCCESS) {
            plugin.getLogger().warning("Helios SSO rejected a player identity mismatch for "
                    + request.username() + ".");
            send(exchange, 401, new ErrorResponse("AUTHENTICATION_FAILED"));
            return;
        }
        BackendClient.SsoRequest backendRequest = new BackendClient.SsoRequest(
                request.ticket(), request.serverId(), request.username(), request.uuid().toLowerCase()
        );
        if(!backendClient.consume(backendRequest)) {
            plugin.getLogger().warning("Helios SSO backend rejected the ticket for "
                    + request.username() + ".");
            send(exchange, 401, new ErrorResponse("AUTHENTICATION_FAILED"));
            return;
        }
        SyncResult login = forceLogin(request);
        if(login != SyncResult.SUCCESS) {
            plugin.getLogger().warning("Helios SSO AuthMe force-login was rejected for "
                    + request.username() + ".");
            send(exchange, 401, new ErrorResponse("AUTHENTICATION_FAILED"));
            return;
        }
        plugin.getLogger().info("Helios SSO completed AuthMe force-login for " + request.username() + ".");
        send(exchange, 200, new SsoResponse(true));
    }

    private AuthRequest authenticateAndParse(HttpExchange exchange) throws IOException {
        return authenticateAndParse(exchange, AuthRequest.class);
    }

    private <T> T authenticateAndParse(HttpExchange exchange, Class<T> requestType) throws IOException {
        try {
            if(!"POST".equals(exchange.getRequestMethod())) {
                send(exchange, 404, new ErrorResponse("NOT_FOUND"));
                return null;
            }
            String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
            if(contentType == null || !contentType.toLowerCase().startsWith("application/json")) {
                send(exchange, 415, new ErrorResponse("UNSUPPORTED_MEDIA_TYPE"));
                return null;
            }
            byte[] body = readBody(exchange.getRequestBody());
            if(!authenticator.verify(
                    exchange.getRequestMethod(),
                    exchange.getRequestURI().getPath(),
                    body,
                    exchange.getRequestHeaders())) {
                send(exchange, 401, new ErrorResponse("UNAUTHORIZED"));
                return null;
            }
            return gson.fromJson(new String(body, StandardCharsets.UTF_8), requestType);
        } catch(RequestTooLargeException exception) {
            send(exchange, 413, new ErrorResponse("REQUEST_TOO_LARGE"));
        } catch(JsonParseException exception) {
            send(exchange, 400, new ErrorResponse("INVALID_REQUEST"));
        } catch(RuntimeException exception) {
            send(exchange, 503, new ErrorResponse("SERVICE_UNAVAILABLE"));
        }
        return null;
    }

    private static boolean isValid(AuthRequest request) {
        return request != null
                && request.username() != null
                && request.username().matches("[A-Za-z0-9_]{3,16}")
                && request.password() != null
                && request.password().length() >= 8
                && request.password().length() <= 128
                && request.password().chars().noneMatch(character -> character < 32 || character == 127);
    }

    private static boolean isValid(SsoRequest request) {
        if(request == null
                || request.ticket() == null
                || request.ticket().length() < 32
                || request.ticket().length() > 128
                || request.serverId() == null
                || request.serverId().isBlank()
                || request.serverId().length() > 128
                || request.username() == null
                || !request.username().matches("[A-Za-z0-9_]{3,16}")
                || request.uuid() == null) {
            return false;
        }
        try {
            UUID.fromString(request.uuid());
            return true;
        } catch(IllegalArgumentException ignored) {
            return false;
        }
    }

    private SyncResult playerMatches(SsoRequest request) {
        try {
            return Bukkit.getScheduler().callSyncMethod(plugin, () -> {
                Player player = Bukkit.getPlayer(UUID.fromString(request.uuid()));
                if(player == null || !player.isOnline()) {
                    return SyncResult.UNAVAILABLE;
                }
                return player.getName().equals(request.username())
                        ? SyncResult.SUCCESS
                        : SyncResult.REJECTED;
            }).get(3, TimeUnit.SECONDS);
        } catch(Exception ignored) {
            return SyncResult.UNAVAILABLE;
        }
    }

    private SyncResult forceLogin(SsoRequest request) {
        try {
            SyncResult initial = Bukkit.getScheduler().callSyncMethod(plugin, () -> {
                Player player = Bukkit.getPlayer(UUID.fromString(request.uuid()));
                AuthMeApi api = AuthMeApi.getInstance();
                if(player == null || !player.isOnline() || !player.getName().equals(request.username()) || api == null) {
                    return SyncResult.REJECTED;
                }
                if(api.isAuthenticated(player)) {
                    return SyncResult.SUCCESS;
                }
                api.forceLogin(player);
                return SyncResult.PENDING;
            }).get(3, TimeUnit.SECONDS);

            if(initial != SyncResult.PENDING) {
                return initial;
            }

            long deadline = System.currentTimeMillis() + AUTHME_CONFIRMATION_TIMEOUT_MILLIS;
            do {
                Thread.sleep(AUTHME_POLL_INTERVAL_MILLIS);
                SyncResult current = Bukkit.getScheduler().callSyncMethod(plugin, () -> {
                    Player player = Bukkit.getPlayer(UUID.fromString(request.uuid()));
                    AuthMeApi api = AuthMeApi.getInstance();
                    if(player == null || !player.isOnline()
                            || !player.getName().equals(request.username()) || api == null) {
                        return SyncResult.REJECTED;
                    }
                    return api.isAuthenticated(player) ? SyncResult.SUCCESS : SyncResult.PENDING;
                }).get(3, TimeUnit.SECONDS);
                if(current != SyncResult.PENDING) {
                    return current;
                }
            } while(System.currentTimeMillis() < deadline);
            return SyncResult.REJECTED;
        } catch(Exception ignored) {
            return SyncResult.UNAVAILABLE;
        }
    }

    private static byte[] readBody(InputStream input) throws IOException, RequestTooLargeException {
        try(ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int count;
            while((count = input.read(buffer)) != -1) {
                total += count;
                if(total > MAX_BODY_BYTES) {
                    throw new RequestTooLargeException();
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private void send(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] encoded = gson.toJson(body).getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.set("Cache-Control", "no-store");
        headers.set("Content-Type", JSON_CONTENT_TYPE);
        headers.set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, encoded.length);
        exchange.getResponseBody().write(encoded);
        exchange.close();
    }

    private static SSLContext createSslContext(Path keyStorePath, char[] password) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try(InputStream input = Files.newInputStream(keyStorePath)) {
            keyStore.load(input, password);
        }
        KeyManagerFactory keyManagerFactory = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keyManagerFactory.init(keyStore, password);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(keyManagerFactory.getKeyManagers(), null, null);
        return context;
    }

    private record AuthRequest(String username, String password, String email) {}
    private record AuthResponse(boolean ok, String username) {}
    private record SsoRequest(String ticket, String serverId, String username, String uuid) {}
    private record SsoResponse(boolean ok) {}
    private record ErrorResponse(String error) {}
    private enum SyncResult { SUCCESS, REJECTED, UNAVAILABLE, PENDING }
    private static final class RequestTooLargeException extends Exception {}
}
