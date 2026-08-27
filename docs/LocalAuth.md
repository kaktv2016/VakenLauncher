# Local/AuthMe and SSO deployment

## 1. Build artifacts

Use Java 21 and Node 22:

```powershell
npm ci
npm test
npm run build:bridge
npm run build:sso-mod
npm run dist:server
```

Outputs:

- `services/youer-authme-bridge/target/youer-authme-bridge-0.1.0.jar`
- `services/neoforge-sso-companion/build/libs/helios_sso-0.1.0.jar`
- `dist/Helios-Youer-Server-Bundle-0.1.0.zip`

The build helpers download Maven 3.9.16 and Gradle 9.2.1 into a temporary
cache and verify their published checksums before use.

The server bundle places the plugin and mod under their intended Youer
directories, includes the backend source and example-only configuration, and
adds `SHA256SUMS` plus `PinnedArtifacts.json`. The latter records the exact
Youer Actions build, NeoForge installer, and AuthMe release sizes and SHA-256
digests used for staging. The bundle contains placeholders rather than
deployment secrets and intentionally does not redistribute Youer or AuthMe.

## 2. Configure the Launcher

Edit `app/assets/launcher-config.json` before packaging:

```json
{
  "authApiBaseUrl": "https://accounts.example.com/",
  "serverId": "youer-main",
  "language": "th_TH"
}
```

`authApiBaseUrl` must be HTTPS. `serverId` must equal the backend and server
mod configuration. `language` may be `en_US` or `th_TH`; environment variables
documented in `app/assets/js/ipcconstants.js` can override deployment values.

The distribution server must use `autoconnect: true`, and its `address` must
be the same address Minecraft reports for the connection. Add the companion
JAR as a required `NeoForgeMod`, for example:

```json
{
  "id": "com.helios:helios_sso:0.1.0",
  "name": "Helios SSO Companion",
  "type": "NeoForgeMod",
  "required": { "value": true, "def": true },
  "artifact": {
    "size": 12694,
    "MD5": "replace-with-the-built-jar-md5",
    "url": "https://cdn.example.com/mods/helios_sso-0.1.0.jar"
  }
}
```

Always calculate the deployed JAR's real size and digest after the final
build; do not copy the illustrative values above.

## 3. Run the authentication backend

Copy `services/auth-backend/.env.example` into the service manager's secret
configuration. Generate independent random secrets of at least 32 bytes.
`HELIOS_BRIDGE_SECRET` must match the Bukkit plugin and dedicated-server mod;
it must never be configured in the Launcher.

Recommended production layout:

- Backend listens on `127.0.0.1:8443` with TLS.
- A reverse proxy exposes only required `/api/auth/*` routes as
  `https://accounts.example.com` and blocks `/internal/*` externally.
- Set `HELIOS_TRUST_PROXY=true` only when that proxy is on loopback and
  overwrites `X-Forwarded-For`.
- Give the service account exclusive access to the SQLite file, TLS key, and
  backups. Back up SQLite with a SQLite-aware snapshot method.
- Keep a single backend process unless the in-memory IP/name rate limiter and
  nonce cache are replaced with shared storage.

The optional email belongs to this backend and recovery service; it is not
written directly into AuthMe's database.

## 4. Install the Youer server components

1. Use the pinned MMORPG server runtime: Youer build `2ddc7e32-axiomfix`,
   AuthMe 6.0.0 `Spigot-Legacy`, and PacketEvents 2.13.0 for Spigot. Verify all
   three against `PinnedArtifacts.json` before starting the server. The
   `Spigot-1.21` AuthMe 6.0.0 artifact targets API 1.21.11 and is not compatible
   with this Minecraft 1.21.1 server.
2. Install AuthMe in Youer's `plugins` directory and complete its normal
   database/password-hash configuration.
3. Install `youer-authme-bridge-0.1.0.jar` in `plugins`.
4. Install `helios_sso-0.1.0.jar` in the dedicated server's `mods` directory.
5. Copy `services/neoforge-sso-companion/helios_sso.properties.example` to
   `config/helios_sso.properties` and set the loopback bridge URL, server ID,
   and shared secret.
6. Configure the Bukkit bridge's PKCS#12 keystore, backend URL, and backend
   truststore in `plugins/HeliosAuthBridge/config.yml`, preferably overriding
   secrets with environment variables.
7. Configure the companion's private PKCS#12 truststore path in
   `config/helios_sso.properties`. Both Java components create dedicated HTTP
   clients from this truststore, so the server can retain the JVM's normal
   public CA behavior for Mojang and other HTTPS services. Java properties
   treat backslashes as escapes; write Windows paths with doubled backslashes
   (for example `C:\\server\\_helios\\truststore.p12`) or use forward slashes.
   `configure-youer-runtime.js` performs this escaping automatically.
8. Keep the bridge bound to loopback and firewall it from every external
   interface. Synchronize backend and Youer clocks with NTP; signed service
   requests allow 30 seconds of skew.

Before accepting the EULA, the exact staged runtime can be checked without
starting a playable server. From this launcher repository, run:

```powershell
npm run verify:youer-pre-eula -- `
  --server-dir C:\staging\youer `
  --java "C:\Program Files\Java\jdk-21\bin\java.exe"
```

The verifier checks the pinned Youer server, AuthMe, and PacketEvents JAR
hashes, requires both Helios components, confirms Youer's embedded NeoForge
version and mod discovery output, and refuses to run if `eula=true` is already
present.
The same dependency-free verifier is also included in the server bundle; from
an extracted bundle use `node tools/verify-youer-stage.js --server-dir .`.

For direct Local accounts, Youer/AuthMe must use the intended offline-mode
flow. Do not allow account renaming because offline UUIDs include exact
username casing.

The explicitly authorized MMORPG staging runtime currently uses
`online-mode=false` and `enforce-secure-profile=false` so its Local UUID is the
stable offline UUID recorded by the backend. This is staging-only; production
still requires a backed-up and approved UUID/playerdata/permissions migration
plan before changing its trust mode.

## 5. Verification checklist

- Register and log in with a new Local account; confirm no password column or
  plaintext credential exists in the Helios database/config/logs.
- Launch once and confirm AuthMe reports authenticated without chat commands.
- Replay the captured ticket and confirm rejection.
- Test expired ticket, wrong server ID, wrong UUID/name, logout-before-join,
  bridge unavailable, backend unavailable, and clock skew.
- Confirm the bridge port and backend `/internal/*` cannot be reached from a
  player network.
- Test Thai and English UI, account switching, refresh rotation, cancel flows,
  Windows safeStorage, and the packaged installer.
- Repeat on a clean Windows machine and on a staging copy of the exact Youer,
  NeoForge, AuthMe, and PacketEvents versions used in production.

ยังต้องทำ live integration test บนเซิร์ฟเวอร์จริงก่อนเปิดใช้งาน โดยเฉพาะ
Local UUID, AuthMe force-login และความเข้ากันได้ของ Youer; unit/build tests
เพียงอย่างเดียวไม่สามารถยืนยันพฤติกรรมของ hybrid runtime ได้
