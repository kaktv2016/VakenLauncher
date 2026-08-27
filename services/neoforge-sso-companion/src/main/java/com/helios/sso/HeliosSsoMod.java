package com.helios.sso;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;

@Mod(HeliosSsoMod.MOD_ID)
public final class HeliosSsoMod {
    public static final String MOD_ID = "helios_sso";

    public HeliosSsoMod(IEventBus modBus) {
        modBus.addListener(HeliosSsoMod::registerPayloads);
    }

    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1");
        registrar.playToServer(SsoPayload.TYPE, SsoPayload.STREAM_CODEC, ServerSsoHandler::handle);
    }
}
