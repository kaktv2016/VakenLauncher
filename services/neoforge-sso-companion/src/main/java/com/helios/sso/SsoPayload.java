package com.helios.sso;

import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

record SsoPayload(String ticket, String serverId) implements CustomPacketPayload {
    static final Type<SsoPayload> TYPE = new Type<>(
            ResourceLocation.fromNamespaceAndPath(HeliosSsoMod.MOD_ID, "ticket")
    );
    static final StreamCodec<ByteBuf, SsoPayload> STREAM_CODEC = StreamCodec.composite(
            ByteBufCodecs.STRING_UTF8,
            SsoPayload::ticket,
            ByteBufCodecs.STRING_UTF8,
            SsoPayload::serverId,
            SsoPayload::new
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
