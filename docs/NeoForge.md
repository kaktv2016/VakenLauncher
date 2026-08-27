# NeoForge 1.21.1 distributions

This launcher carries a version-pinned downstream compatibility patch for
`helios-core` 2.3.0 and `helios-distribution-types` 1.3.0. `npm install` runs
`tools/apply-dependency-patches.js`, which adds the `NeoForge` and
`NeoForgeMod` types and teaches the core distribution processor where to put
and how to load their artifacts. The patch intentionally fails when either
dependency version changes so an upgrade cannot silently discard NeoForge
support.

## Supported launch shape

The Phase 1 implementation is intentionally pinned to Minecraft 1.21.1. A
NeoForge manifest is accepted only when it:

- inherits from Minecraft 1.21.1;
- launches `cpw.mods.bootstraplauncher.BootstrapLauncher`;
- declares the NeoForge FML and `ALL-MODULE-PATH` arguments; and
- does not contain the removed `--fml.modLists` or `--fml.mavenRoots`
  arguments.

The example is generated from a successful client install of NeoForge
21.1.248. This matches the selected MMORPG server's Youer 1.21.1 build
`2ddc7e32-axiomfix`. That JAR was built from the included Youer source checkout
at commit `2ddc7e32f310d1ae331a70067bba21912182bc6e` with the documented
NetworkRegistry compatibility patch. Pin the resulting JAR digest, NeoForge
version, and client distribution together.

The top-level `NeoForge` module is the installer-generated SRG client artifact
(`net.minecraft:client:1.21.1-20240808.144430:srg`). It is used as the Helios
loader anchor and repair target, but is not added directly to the ordinary JVM
classpath. NeoForge's production provider loads the transformed client through
BootstrapLauncher and the arguments from the installed version manifest.

The staging artifacts were verified before use:

- Youer `2ddc7e32-axiomfix` server JAR SHA-256:
  `e35eb56b67b180b0d44a24b8e9909af764b56d79114f245f613717e6ec29d0bd`;
- NeoForge 21.1.248 installer SHA-256:
  `68eeab77059ba53df1812f1afa5bf530ab2566a3cdcd5f924aa6e71be42e410c`;
- AuthMe 6.0.0 Spigot Legacy SHA-256:
  `7fcf370763d02528eabbe4418e6bbe7e5d5e6a8f8cbead31ef954877a8b0f1a2`;
- PacketEvents 2.13.0 Spigot SHA-256:
  `6d9ece0d87ee727a79a20b7ffbd432021609c6f52bafcb654fc2d3e9b6f064c5`.

The first full staging boot proved that AuthMe 6.0.0's `Spigot-1.21` artifact
targets Bukkit API 1.21.11 and is rejected by Youer 1.21.1. The MMORPG server
already uses the official `Spigot-Legacy` artifact from the same release; it
declares API 1.16, retains the required public v3 API, and has prior successful
runtime evidence on this exact server. Do not substitute the incompatible
`Spigot-1.21` artifact.

## Generate a distribution

First run the official NeoForge installer into an empty client directory. The
directory must contain `versions/<version-id>/<version-id>.json` and the
installer-generated `libraries` tree. Then run:

```powershell
npm run generate:neoforge -- `
  --client-dir C:\build\neoforge-client `
  --version-id neoforge-21.1.248 `
  --base-url https://cdn.example.com/helios `
  --repo-dir C:\build\helios-cdn `
  --instance-dir C:\build\modpack `
  --optional-mod example-optional-mod.jar `
  --server-id production-1.21.1 `
  --server-name "Production Server" `
  --server-address mc.example.com:25565 `
  --output C:\build\distribution.json
```

`--repo-dir` is optional. When provided, the generator creates the exact
`repo/libraries`, `repo/versions`, and `instance` directory structure expected
under `--base-url`. It calculates MD5 and size from every staged file. Host the
result through HTTPS and do not change a staged artifact without regenerating
the distribution.

The optional `--instance-dir` may contain:

- `mods/*.jar`, emitted as `NeoForgeMod`;
- `config/**` and `defaultconfigs/**`, emitted as `File`; and
- `resourcepacks/**`, emitted as `File`.

Every mod is required unless its file name is passed through a repeatable
`--optional-mod` option. Optional NeoForge mods remain compatible with the
existing Helios account-independent mod-selection UI.

## Runtime paths

`NeoForge` loader artifacts and libraries are stored in the shared
`common/libraries` Maven tree. `NeoForgeMod` files are stored directly in the
selected instance's `mods` directory so NeoForge discovers them normally.
Configs and resource packs retain the relative paths declared by their `File`
modules. All modules continue through Helios Core's recursive MD5 validation,
download, and repair pipeline.

The generated server configuration explicitly selects 64-bit Windows and Java
21 Temurin. Helios Core already rejects 32-bit Java, validates the configured
semver range, and can automatically install a matching 64-bit JDK.

## MMORPG staging workflow

The checked-in tooling can reproduce the local Phase 1 staging environment
without placing a server password, bridge secret, signing key, or database
credential in the launcher distribution.

1. Install NeoForge 21.1.248 into a clean client directory with the official
   installer and a minimal `launcher_profiles.json`.
2. Copy only client-safe `mods`, `config`, `defaultconfigs`, and
   `resourcepacks` into a staging instance. Never copy
   `config/helios_sso.properties`; it is server-only and contains private
   bridge configuration.
3. Generate the repository and distribution with
   `npm run generate:neoforge` as shown above.
4. For standalone repository diagnostics, it can be served on loopback HTTPS with:

   ```powershell
   npm run serve:neoforge-staging -- `
     --root C:\path\to\MMORPG\_helios\phase1\cdn `
     --runtime C:\path\to\MMORPG\_helios\runtime.json `
     --port 9443
   ```

5. Start the source launcher against the staging backend and distribution. This
   command now starts both loopback HTTPS services automatically when needed:

   ```powershell
   npm run start:neoforge-staging -- `
     --server-root C:\path\to\MMORPG
   ```

6. Run the same recursive repair pipeline used by the launcher and require a
   clean second pass:

   ```powershell
   npm run verify:neoforge-staging -- `
     --server-root C:\path\to\MMORPG `
     --launcher-dir "$env:APPDATA\VakenLauncher" `
     --data-dir "$env:APPDATA\.helioslauncher" `
     --server-id youer-main
   ```

The local Phase 1 run on 2026-08-27 verified 4,290 files (about 1.45 GB) with
zero invalid files on both verification passes. The resolved manifests were
Minecraft 1.21.1 and `neoforge-21.1.248`, using Java `21.x` and
`cpw.mods.bootstraplauncher.BootstrapLauncher`. A live launch then completed
NeoForge initialization in about 122 seconds, autoconnected to the MMORPG
staging server, and placed `Hibire002` in the world. The server subsequently
stalled during its player-login work and AuthMe disconnected the player after
its login timeout; the watchdog stacks point to server-side Quark/Zeta and
chunk processing, not a launcher or NeoForge client compatibility failure.

## Youer integration boundary

Youer is the server platform, but it does not change the client launch shape:
the client still launches ordinary NeoForge 1.21.1 and connects directly to
the Youer server. Phase 1 contains no AuthMe credentials, tickets, local-login
code, or server trust decisions. Those belong to the later backend and bridge
phases and must be tested against the exact Youer and AuthMe builds selected
for production.
