# Diamond Shine Field

Offline-first Expo app for field teams. It shares the same tenant-safe API as the management web application and includes assigned schedules, visit timers, GPS audit signals, structured checklists, proof photos, incident reporting, stock counts, replenishment requests, notices and timesheets.

## Local setup

1. Copy `.env.example` to `.env.local` and use an API URL reachable by the device. A physical phone cannot use the computer's `localhost`; use the computer's LAN IP instead.
2. Run `npm install` in this directory if dependencies are not present.
3. From the repository root run `npm run mobile:start`, then open the QR code with Expo Go.

Useful checks from the repository root:

```bash
npm run mobile:typecheck
npm --prefix apps/mobile run lint
npm --prefix apps/mobile run export:web
```

Authentication tokens are stored in the native secure keychain. Visits and pending operations are stored locally in SQLite and synchronize idempotently when connectivity returns.

For production push notifications, set `EXPO_PUBLIC_EAS_PROJECT_ID`, configure Android FCM v1 and iOS APNs credentials in EAS, and optionally enable Expo push access-token security with `EXPO_PUSH_ACCESS_TOKEN` on the server. The app creates separate normal and urgent operational channels and opens the Inbox when a notice is tapped.

Build profiles are defined in `eas.json`:

```bash
npx eas-cli build --profile preview --platform all
npx eas-cli build --profile production --platform all
npx eas-cli submit --profile production --platform all
```

Use `preview` for internal field acceptance and `production` only after the repository release gate, GPS/checklist/evidence offline smoke tests, and push delivery tests pass on physical Android and iOS devices.
