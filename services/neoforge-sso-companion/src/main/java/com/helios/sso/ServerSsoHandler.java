package com.helios.sso;

import com.mojang.logging.LogUtils;
import java.util.concurrent.CompletableFuture;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import org.slf4j.Logger;

final class ServerSsoHandler {
    private static final Logger LOGGER = LogUtils.getLogger();

    private ServerSsoHandler() {}

    static void handle(SsoPayload payload, IPayloadContext context) {
        if(!(context.player() instanceof ServerPlayer player)
                || payload.ticket() == null
                || payload.ticket().length() < 32
                || payload.ticket().length() > 128
                || payload.serverId() == null
                || payload.serverId().isBlank()
                || payload.serverId().length() > 128) {
            return;
        }
        String username = player.getGameProfile().getName();
        String uuid = player.getUUID().toString();
        CompletableFuture.runAsync(() -> {
            boolean authenticated = BridgeSubmitter.submitWithRetry(
                    payload.ticket(), payload.serverId(), username, uuid
            );
            if(authenticated) {
                LOGGER.info("Helios SSO authenticated player {} through the server bridge.", username);
            } else {
                LOGGER.warn("Helios SSO rejected or could not complete authentication for player {}.", username);
            }
        });
    }
}
