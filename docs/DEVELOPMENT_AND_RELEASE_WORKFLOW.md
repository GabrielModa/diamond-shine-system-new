# Development and release workflow

Run all standard commands from the repository root, including in Windows Git Bash. Node scripts resolve the actual project directory, including spaces and accented characters. Use Node 22 LTS and npm. Keep PostgreSQL local/test credentials separate from production.

## First-time setup

```sh
npm ci
npm --prefix apps/mobile ci
```

Create the root `.env` from the root `.env.example` and configure a **local development database** and local server settings. Only after verifying that database is local, run `npm run db:setup`. This task does not migrate or seed production.

Do **not** copy the root `.env` into mobile. Standard launchers need no mobile `.env`; they override the API URL in memory and disable Expo dotenv loading. Only `EXPO_PUBLIC_*` values belong in the mobile bundle. Never put database, session, SMTP, Google server or service-role credentials there.

```sh
node scripts/eas.mjs login
node scripts/eas.mjs whoami
npm run doctor:mobile
npm run mobile:build:development
```

Log in to an Expo account with access to `vercel-production/diamond-shine-field`, project `8aa9ac64-8d87-4aea-b2f8-79258d269e29`. Follow the EAS build link, download its Android APK on the Samsung phone, and install it. Android package: `ie.diamondshine.field`. First builds may prompt for Android signing credentials; preserve the existing keystore.

## Everyday commands

| Command | Behavior |
| --- | --- |
| `npm run dev:web` | Next.js on `0.0.0.0:3000` |
| `npm run dev:all` | Local web/API plus development-client Metro on LAN port 8081 |
| `npm run dev:mobile` | Metro only, API at the detected PC LAN address on port 3000 |
| `npm run dev:mobile:prod-api` | LAN Metro with an explicit production API warning |
| `npm run doctor:mobile` | Dependencies, SDK check, project link, env warnings, LAN, health endpoints, adb and firewall guidance |

For normal work use **`npm run dev:all`**. Open Diamond Shine Field, choose the current server or scan the fresh QR code. Expo Go is not the standard runtime. Ctrl+C terminates both server trees. Restart Metro after changing API environment. Switching API environments requires sign-in again; existing offline work remains associated with its original workspace.

If multiple adapters exist, set `DIAMOND_LAN_IP` in your shell to an IPv4 assigned to your PC. Wi-Fi is preferred; virtual/VPN adapters are excluded by default. Never commit a personal LAN address. Do not repeatedly `cd apps/mobile`.

## EAS environments and one-time account setup

In the Expo project's Environment variables page, create `EXPO_PUBLIC_API_URL` as **plain text** for `development`, `preview`, and `production`, with value `https://diamond-shine-system-new.vercel.app`. Preview intentionally uses the production backend. Local launchers override this with the LAN URL. There is no separate preview-backend model.

`eas.json` explicitly associates each build profile with the same-named environment and channel. Production/preview builds reject a missing or different URL. OTA always uses `--environment production`, so SDK 54 cannot accidentally publish with a local dotenv URL.

Create an Expo personal access token in [Expo account access-token settings](https://expo.dev/settings/access-tokens), using an account authorized for this project. In GitHub repository **Settings → Secrets and variables → Actions → New repository secret**, save it as **`EXPO_TOKEN`**. Never commit it. GitHub's built-in `GITHUB_TOKEN` handles read-only CI/repository checks. No Vercel token is required.

FCM/APNs signing/push setup remains in EAS; server credentials remain on the server. Configure branch protection to require Quality Gate before merging.

## Native builds and OTA

```sh
npm run mobile:build:development
npm run mobile:build:preview
npm run mobile:build:production
```

Builds are intentional and may consume EAS quota. Development and preview produce installable internal Android builds; production uses the store artifact (AAB). Distribute production through Google Play testing/production tracks. Preview is suitable for APK testing but listens to the preview channel, not automatic production updates.

**One new development build and one new production build are required after this PR.** The launcher plugin and expo-updates are native configuration. Existing APKs cannot acquire those changes through OTA. Build/install a new preview APK too if using preview.

Normal React/TypeScript/UI/style changes use OTA without reinstalling. `runtimeVersion: { policy: "fingerprint" }` isolates incompatible native runtimes. Expo SDK, native dependencies, plugins, permissions or fingerprint changes require a new native build. The production release checks for a finished Android production-channel binary whose runtime exactly matches the fingerprint; missing compatibility fails with a build-required explanation. It never creates paid native builds automatically. Older incompatible installations keep their compatible update and must upgrade their binary.

On normal cold startup, expo-updates checks/downloads updates; a downloaded update normally becomes active on the next restart. Do not force reload during field work. Inspect More → About / Diagnostics for active update ID, runtime, channel, native version and actual API URL. Git ID appears when explicitly provided as a public bundle variable; release messages always include the full SHA. Web exposes `/api/health/version` with build SHA/time/environment/version and no secrets.

## After merge to main

1. Existing Vercel Git integration automatically deploys the web/API, unchanged.
2. Existing Quality Gate runs all its checks, plus workflow helper tests.
3. Mobile Production OTA runs after successful Quality Gate. It verifies the latest push run for the exact SHA and checks that SHA is still main HEAD.
4. It waits up to 35 minutes for the production domain's version endpoint to serve that exact SHA in the production environment and for `/api/health` to return success. This is stronger than accepting a generic Vercel preview status.
5. EAS computes the production Android fingerprint and looks for a compatible finished production binary. Gates are checked again before publishing Android OTA to the production channel.

Superseded commits, failed checks, unhealthy/wrong backend, missing token/environment or missing binary block publication. No database mutation is performed by the release workflow. Production API changes must remain backward compatible with older installed mobile runtimes; backend deployment and OTA are not an atomic transaction.

For a safe retry, open GitHub Actions → Mobile Production OTA → Run workflow on **main**. It repeats all gates; it cannot publish an arbitrary older SHA. After the first compatible production build, use this retry to complete initial setup. Production OTA is Android-only; iOS requires its own binary compatibility gate before enabling automatic publication.

## Troubleshooting

- **Failed to download remote update / stale launcher:** install the rebuilt development APK with `launchMode: launcher`. Open from the home screen and choose the fresh Metro address. Old binaries still use their compiled launch mode. Clear stale recent entries in the launcher, not app storage containing unsynced work.
- **Metro unreachable:** on the phone open `http://<PC-IP>:8081/status`. Confirm Metro is running and both devices share Wi-Fi. Guest network/AP isolation, VPNs and firewall rules can block it. Scan the current QR; old tunnels expire.
- **API unreachable:** open `http://<PC-IP>:3000/api/health/live` on the phone. Start `dev:web` or `dev:all`; verify port 3000 and the printed adapter address.
- **localhost:** the phone's localhost is the phone itself. Standard LAN launchers never default to it. A direct Expo launch with no public API configured shows no implicit localhost fallback.
- **Windows Firewall:** allow Node.js on Private networks and inspect inbound TCP 3000/8081 rules. Doctor only reports guidance; it never changes the firewall.
- **Different networks:** LAN Metro will not work. Join the same Wi-Fi. A Metro tunnel alone does not expose the local API. The prod-api command solves backend reachability only; its Metro still uses LAN.
- **USB fallback (manual):** with Android platform-tools and USB debugging authorized, `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:8081 tcp:8081` forward the ports. This is an advanced explicit localhost setup; standard commands remain LAN to avoid silently changing networking semantics.
- **EAS incompatibility:** build/distribute production intentionally, then retry on latest main. Never replace fingerprint with a constant or force an update into an incompatible runtime.
- **Release timeout:** inspect Quality Gate and Vercel, compare `/api/health/version` with main SHA, and retry after fixing deployment. A newer main commit supersedes old releases.

## Verification and references

`npm run test:workflow` covers LAN selection, environment precedence/secret exclusion, latest exact-SHA quality checks, production version matching and native compatibility. CI retains typechecks, lint, unit/integration, build, export/source checks and E2E against its isolated PostgreSQL service.

Official references: [SDK 54 development launcher](https://docs.expo.dev/versions/v54.0.0/sdk/dev-client/), [SDK 54 updates](https://docs.expo.dev/versions/v54.0.0/sdk/updates/), [runtime policies](https://docs.expo.dev/eas-update/runtime-versions/), [EAS environments](https://docs.expo.dev/eas/environment-variables/usage/).
