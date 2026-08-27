package com.helios.sso;

import com.mojang.logging.LogUtils;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import org.slf4j.Logger;

@EventBusSubscriber(modid = HeliosSsoMod.MOD_ID, value = Dist.CLIENT)
final class ClientTicketSender {
    private static final String FILE_NAME = ".helios-sso-ticket.json";
    private static final long TICKET_WAIT_MILLIS = 20_000;
    private static final Logger LOGGER = LogUtils.getLogger();
    private static Object activeConnection;
    private static long ticketWaitDeadline;
    private static boolean ticketHandled;

    private ClientTicketSender() {}

    @SubscribeEvent
    static void onClientTick(ClientTickEvent.Post event) {
        Minecraft minecraft = Minecraft.getInstance();
        Object connection = minecraft.getConnection();
        if(connection == null || minecraft.player == null) {
            activeConnection = null;
            ticketHandled = false;
            return;
        }
        if(connection != activeConnection) {
            activeConnection = connection;
            ticketWaitDeadline = System.currentTimeMillis() + TICKET_WAIT_MILLIS;
            ticketHandled = false;
        }
        if(ticketHandled) {
            return;
        }
        if(System.currentTimeMillis() > ticketWaitDeadline) {
            ticketHandled = true;
            LOGGER.warn("Helios SSO did not receive a fresh ticket before the connection deadline.");
            return;
        }
        ticketHandled = sendTicket(minecraft);
    }

    private static boolean sendTicket(Minecraft minecraft) {
        Path ticketFile = minecraft.gameDirectory.toPath().resolve(FILE_NAME);
        try {
            if(!Files.isRegularFile(ticketFile)) {
                return false;
            }
            if(Files.size(ticketFile) > 4096) {
                Files.deleteIfExists(ticketFile);
                return true;
            }
            String serialized = Files.readString(ticketFile, StandardCharsets.UTF_8);
            Files.deleteIfExists(ticketFile);
            JsonObject object = JsonParser.parseString(serialized).getAsJsonObject();
            String ticket = object.get("ticket").getAsString();
            String serverId = object.get("serverId").getAsString();
            String expectedAddress = normalizeAddress(object.get("serverAddress").getAsString());
            long expiresAt = object.get("expiresAt").getAsLong();
            ServerData currentServer = minecraft.getCurrentServer();
            if(currentServer == null
                    || !normalizeAddress(currentServer.ip).equals(expectedAddress)
                    || expiresAt <= System.currentTimeMillis()
                    || ticket.length() < 32
                    || ticket.length() > 128
                    || serverId.isBlank()
                    || serverId.length() > 128) {
                LOGGER.warn("Helios SSO rejected an invalid or expired ticket envelope.");
                return true;
            }
            PacketDistributor.sendToServer(new SsoPayload(ticket, serverId));
            LOGGER.info("Helios SSO sent a one-time ticket payload for server {}.", serverId);
            return true;
        } catch(Exception ignored) {
            try {
                Files.deleteIfExists(ticketFile);
            } catch(Exception ignoredAgain) {
                // The credential expires quickly and cannot be replayed after consumption.
            }
            LOGGER.warn("Helios SSO could not read or send the ticket envelope.");
            return true;
        }
    }

    private static String normalizeAddress(String address) {
        return address == null ? "" : address.trim().toLowerCase();
    }
}
