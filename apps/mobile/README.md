# Diamond Shine Field

Offline-first Expo app for field teams. It shares the tenant-safe Diamond Shine API and includes assigned schedules, visit timers, event-based GPS audit signals, structured checklists, durable proof photos, incidents, stock counts, operational notices and timesheets.

## Local physical-device setup

1. Run the web/API server on the LAN, for example `npm run dev -- --hostname 0.0.0.0`.
2. On a physical phone, use the computer LAN address in **Server settings** (for example `http://192.168.1.20:3000`). `localhost` points to the phone itself.
3. Run `npm run mobile:start` from the repository root and open the QR code with Expo Go.

Expo Go is intentionally a **UI / camera / GPS / offline-sync test runtime**. Remote push is disabled there because Expo Go on modern Android SDKs no longer supports the app's remote notification pipeline. The app must remain fully interactive in Expo Go instead of importing `expo-notifications` at bootstrap.

For remote push, use a development/preview native build. The repository has EAS profiles in `eas.json`, and `expo-dev-client` is included by the mobile hardening feature.

## Install dependencies after applying a source patch

```bash
npm --prefix apps/mobile install
```

## Targeted checks

```bash
npm run mobile:source-check
npm run mobile:typecheck
npm run mobile:lint
npm run mobile:export
npm run test:integration:mobile-hardening
```

The integration test changes the configured test database. Reseed demo data afterwards before build/E2E work.

## Mobile safety model

- Access tokens stay in native secure storage.
- A different user cannot take over an offline workspace that still has unsynced mutations from the previous account.
- Offline starts/tasks/incidents/time/material counts synchronize idempotently.
- HTTP 207 partial sync is processed per operation: successful changes are kept and conflicts remain visible/pending.
- Binary evidence captured offline is copied from camera cache into the app document directory before it is queued and removed only after upload succeeds.
- Visit completion synchronizes after ordinary mutations and evidence, so required proof is not bypassed by queue ordering.
- Only actively assigned employees / field supervisors get field-execution controls. Management roles may review visit detail but do not get a mobile “start cleaning” button merely because their API role is privileged.
- Manager/supervisor **Operations** intelligence is intentionally a separate cross-system feature so desktop and mobile consume the same schedule-health truth.

## Production push

Set `EXPO_PUBLIC_EAS_PROJECT_ID`, configure Android FCM v1 and iOS APNs credentials in EAS, and optionally protect Expo push calls on the server with `EXPO_PUSH_ACCESS_TOKEN`.

```bash
npx eas-cli build --profile development --platform android
npx eas-cli build --profile development --platform ios
npx eas-cli build --profile preview --platform all
```

Use preview for internal field acceptance. Production builds come only after the repository release gate plus physical Android/iOS tests for permissions, offline/reconnect, app kill/reopen, session revocation and push foreground/background/terminated behavior.
