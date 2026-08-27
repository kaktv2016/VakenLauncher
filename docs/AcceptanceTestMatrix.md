# Acceptance test matrix

This matrix distinguishes verified build evidence from checks that require the
real deployment. A green unit test is not treated as proof of Youer runtime
compatibility.

| Requirement | Evidence in this repository | Status |
| --- | --- | --- |
| Hybrid server architecture | Direct Youer + Bukkit/AuthMe bridge design in `AuthenticationArchitecture.md` | Confirmed design |
| Exact hybrid runtime provenance | `PinnedArtifacts.json` records immutable Youer commit/build plus Youer, NeoForge, and AuthMe sizes and SHA-256 digests | Automated pin-consistency pass |
| NeoForge 1.21.1 manifest, arguments, classpath, mods, configs, hashes | Generator/process-builder tests, `neoforge_distribution.example.json`, and local staging distribution generated from the official 21.1.248 installer; live game reached the staging world | Live staging pass |
| Full download/repair pipeline | 4,290 files (about 1.45 GB) downloaded; two recursive verification passes reported 0 invalid files | Live staging pass |
| Java 21 / Windows x64 | Real manifest resolution reported Java `21.x`, Minecraft `1.21.1`, NeoForge `21.1.248`, and BootstrapLauncher; x64 Electron packaging and NSIS installer build completed successfully | Automated/runtime resolution pass |
| Local registration/login through AuthMe API | `Hibire002` was registered and logged in from the Launcher against staging AuthMe through the HTTPS backend/bridge; the Launcher has no direct database access | Live pass |
| Local-only account surface | EJS rendering contains the Local login action and no external-account button; config migration retains only `type: local`; removed backend routes return 404/400 | Automated pass |
| Password never persisted by Launcher/backend | Storage schema and Launcher persistence tests | Automated pass |
| Secure local session lifecycle | DPAPI/safeStorage test, rotating refresh and logout-revocation tests | Automated pass |
| One-time ticket and replay/expiry protection | SQLite atomic-consume, expiry, mismatch, replay, logout tests | Automated pass |
| Node/Java signed-service protocol | Shared fixed HMAC vector verified by both test suites | Automated pass |
| Companion mod client/server separation and payload registration | Compiles against NeoForge 21.1.248; the client autoconnected, sent its one-time payload, and the server companion reported authenticated `Hibire002` | Live SSO pass |
| AuthMe bridge runtime | MMORPG server loaded AuthMe 6.0.0 Legacy, PacketEvents 2.13.0, and HeliosAuthBridge 0.1.0; signed loopback login returned the expected generic failure | Live pass |
| AuthMe automatic `forceLogin` | Public API call runs on the Bukkit main thread and the bridge waits for AuthMe's asynchronous completion; the live server reported `completed AuthMe force-login` | Live pass |
| Thai/English UI | Both complete EJS trees render without missing values | Automated pass |
| Lint, unit tests, dependency audit, Windows installer | ESLint 10 passes; 67 Node tests and 4 Java bridge tests pass; full `npm audit` reports 0 vulnerabilities; Electron 44 `safeStorage` and the x64 NSIS installer build pass | Automated pass |
| Public distribution readiness | The staging catalog and server address still use `127.0.0.1`; production distribution/auth HTTPS URLs, a public server hostname, and Windows code signing are not configured | Not production-ready |
| Player launching without a ticket cannot impersonate another account | Ticket-bound UUID/name checks; a live no-ticket connection remained unauthenticated and AuthMe issued a login-timeout kick | Live fail-closed pass |
| Backend or bridge unavailable | Backend client rejects transport failure; a live companion/bridge-unavailable run left AuthMe unauthenticated and ended in its login-timeout kick | Automated backend-down and live bridge-path fail-closed pass |
| Runtime log and command-line hygiene | Fifteen current Launcher/client/server logs contained no exact runtime secret, JWT, serialized ticket, HMAC signature header, or authorization header; Local Java used the placeholder access-token argument and no transient ticket file remained | Live pass |
| Local player enters without `/login` | `Hibire002` autoconnected, the ticket was consumed once, AuthMe completed login, and the player entered without typing a chat command | Live pass |

## Required staging executions

1. Completed on the MMORPG server: pinned Youer build `2ddc7e32-axiomfix`
   (NeoForge 21.1.248), AuthMe 6.0.0 Spigot Legacy, PacketEvents 2.13.0,
   companion mod, and bridge reached `Done` on Java 21/Windows x64. The server
   also boots through its unchanged `run.bat`; private outbound TLS uses the
   managed truststore without replacing the JVM's public CA set.
2. Run Local register, correct/incorrect login, refresh, logout, autoconnect,
   reconnect, expired/replayed ticket, backend-down, and bridge-down cases.
3. Start an unmodified Minecraft client using the same Local name but no
   ticket and verify AuthMe keeps it unauthenticated.
4. Capture Launcher, backend, Youer, and proxy logs and scan for passwords,
   access/refresh tokens, tickets, HMAC secrets, and authorization headers.

## Local SSO live evidence

The final staging run used the restarted server with the current bridge JAR
and AuthMe sessions disabled. The client connected at 17:15:22, sent a fresh
one-time payload at 17:15:25, and the backend atomically consumed the ticket at
17:15:29. At 17:15:31 AuthMe logged in `Hibire002`, the bridge reported
`completed AuthMe force-login`, and the server companion reported the player
authenticated through the bridge. The player confirmed that no `/login`
command was entered. AuthMe emitted one reminder while its queued login was
finishing, but gameplay authentication completed automatically and there was
no login-timeout kick.

The failure found during staging was a Windows Java-properties escaping bug:
an unescaped `C:\...\truststore.p12` value was parsed with `\t` as a tab, so the
server companion could not load its truststore and never reached the bridge.
The runtime generator now escapes properties values, and a regression test
covers Windows paths. A second false-negative was fixed by waiting for
AuthMe's asynchronous `forceLogin` operation before the bridge responds.

The explicitly authorized temporary MMORPG staging configuration currently has
`online-mode=false` and `enforce-secure-profile=false`, which permits the Local
account path to complete the Minecraft handshake. This is a staging-only UUID
and trust-policy choice. Do not promote it to production until the Local UUID,
playerdata, inventory, and permissions migration plan has been approved and
backed up.
