package com.helios.authbridge;

import java.nio.file.Path;
import org.bukkit.plugin.java.JavaPlugin;

public final class HeliosAuthBridgePlugin extends JavaPlugin {
    private BridgeHttpServer bridgeServer;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        try {
            String sharedSecret = environmentOrConfig("HELIOS_BRIDGE_SHARED_SECRET", "shared-secret");
            String keyStore = environmentOrConfig("HELIOS_BRIDGE_KEYSTORE", "tls-keystore-path");
            String keyStorePassword = environmentOrConfig(
                    "HELIOS_BRIDGE_KEYSTORE_PASSWORD",
                    "tls-keystore-password"
            );
            String backendUrl = environmentOrConfig("HELIOS_AUTH_BACKEND_URL", "backend-url");
            String backendTrustStore = environmentOrConfig(
                    "HELIOS_BACKEND_TRUSTSTORE",
                    "backend-truststore-path"
            );
            String backendTrustStorePassword = environmentOrConfig(
                    "HELIOS_BACKEND_TRUSTSTORE_PASSWORD",
                    "backend-truststore-password"
            );
            rejectPlaceholder(sharedSecret, "bridge shared secret");
            rejectPlaceholder(keyStorePassword, "keystore password");
            rejectPlaceholder(backendTrustStorePassword, "backend truststore password");
            bridgeServer = new BridgeHttpServer(
                    getConfig().getString("bind-address", "127.0.0.1"),
                    getConfig().getInt("port", 8765),
                    Path.of(keyStore).toAbsolutePath().normalize(),
                    keyStorePassword.toCharArray(),
                    sharedSecret,
                    getConfig().getLong("request-clock-skew-seconds", 30),
                    backendUrl,
                    Path.of(backendTrustStore).toAbsolutePath().normalize(),
                    backendTrustStorePassword.toCharArray(),
                    this
            );
            bridgeServer.start();
            getLogger().info("Helios AuthMe bridge started on the configured loopback endpoint.");
        } catch(Exception exception) {
            getLogger().severe("Helios AuthMe bridge failed to start: " + exception.getMessage());
            getServer().getPluginManager().disablePlugin(this);
        }
    }

    @Override
    public void onDisable() {
        if(bridgeServer != null) {
            bridgeServer.stop();
            bridgeServer = null;
        }
    }

    private String environmentOrConfig(String environmentName, String configName) {
        String environmentValue = System.getenv(environmentName);
        return environmentValue == null || environmentValue.isBlank()
                ? getConfig().getString(configName, "")
                : environmentValue;
    }

    private static void rejectPlaceholder(String value, String label) {
        if(value == null || value.isBlank() || "change-me".equals(value)) {
            throw new IllegalArgumentException("A non-placeholder " + label + " is required.");
        }
    }
}
