# Launcher release and update setup

The launcher update client is intentionally disabled while
`app/assets/launcher-config.json` has an empty `updateRepository`. This prevents
development builds from contacting the upstream Helios Launcher repository.

## Repository state

The source is published to the private repository
`https://github.com/kaktv2016/VakenLauncher`. The project remote is `origin` and
the original Helios source is retained as `upstream` for comparisons.

Automatic player updates remain disabled while the repository is private and
`updateRepository` is empty. Do not embed a GitHub personal access token in the
launcher. Before enabling automatic updates, use a public release repository or
make the project repository public, then set `updateRepository` to that HTTPS
repository URL.

## One-time release setup

1. Choose the public GitHub repository that will host player releases.
2. Set `updateRepository` to the HTTPS repository URL, for example
   `https://github.com/OWNER/REPOSITORY`.
3. Configure a Windows release workflow to build and attach the installer,
   blockmap, and `latest.yml` to each versioned GitHub Release.
4. Configure Windows code signing before distributing the installer publicly.

Never commit GitHub tokens, code-signing certificates, TLS keys, database files,
or `_helios` runtime directories. Store release credentials in GitHub Actions
secrets.

## Release sequence

1. Run `npm ci`, `npm run lint`, `npm test`, and `npm run test:bridge`.
2. Increase the semantic version in `package.json` and `package-lock.json`.
3. Build a clean installer with `npm run dist:win`.
4. Test installation, local login, NeoForge 1.21.1 startup, automatic server
   connection, and uninstall on a clean Windows account or virtual machine.
5. Commit the version, create a signed `vX.Y.Z` tag, and push the branch and tag.
6. Publish the matching GitHub Release assets. The update client will use the
   repository configured in `updateRepository`.

## Production prerequisites

Before a public release, replace all loopback staging endpoints with public HTTPS
services, publish the distribution artifacts, configure the real Minecraft server
address, secure and back up the authentication database, and sign the Windows
installer. Local staging URLs such as `127.0.0.1` are not usable by players on
other computers.
