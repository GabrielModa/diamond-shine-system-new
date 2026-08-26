# Mobile Pilot Hardening — Android / iOS

This checkpoint hardens the existing Diamond Shine Field app before physical-device pilot testing. It does not redesign the product or duplicate the desktop management cockpit.

## Product boundary

Employee mobile is the field execution tool. Admin/supervisor mobile remains intentionally operational and lightweight. The shared Schedule Intelligence / Service Continuity feature will add manager “Operations today” later from an authoritative backend model shared with desktop.

## Acceptance criteria

### Expo Go compatibility

Given the Android app is opened with Expo Go on Expo SDK 54,
when the JS bundle boots,
then `expo-notifications` is not evaluated at startup, the UI remains interactive, and remote push is reported as intentionally unavailable in that runtime.

### Native push

Given a development/preview/production native build with valid EAS project and provider credentials,
when a user grants notification permission,
then the device token is registered and tapping an operational notice routes to Inbox, including a cold launch from a notification response.

### Safe areas

Given Android edge-to-edge or an iPhone with a notch/home indicator,
when app screens and the evidence camera render,
then layout uses `react-native-safe-area-context` rather than deprecated React Native `SafeAreaView`.

### Partial offline sync

Given four queued operations where the server returns three processed results and one conflict using HTTP 207,
when sync runs,
then the three successful operations are removed, the conflict remains queued with its error, and the user sees that sync needs attention.

### Queue causality

Given a visit was started and completed while offline with task updates and proof photos,
when connectivity returns,
then ordinary mutations synchronize first, evidence uploads after the start/task results exist, and visit completion is attempted last.

### Offline evidence durability

Given a photo is captured while offline,
when it is queued,
then it is copied into the application document directory instead of relying on a camera-cache URI; after confirmed upload the durable local copy is removed.

### Account isolation

Given account A has unsynced work on a device,
when account B attempts to sign in,
then account switching is blocked rather than deleting A's work or exposing A's cached visits to B.

Given A has no pending changes and B signs in,
then stale visit/stock/timer cache is cleared before B's workspace is activated.

### Single active local timer

Given any visit/general timer is active locally,
when the user attempts to start another timer,
then the mobile client blocks it before creating contradictory offline state.

### Operational timezone

Given the organization timezone differs from the phone timezone,
when schedule, Today, visit, work, timesheet, availability or time-history times are rendered,
then operational wall-clock time is formatted using the server-provided organization/visit timezone.

### Permissions

Given camera permission is permanently denied,
when the evidence screen opens,
then the user is offered a direct path to device settings.

Given location permission/GPS is unavailable,
when a supported field action is recorded,
then the action can proceed with missing-GPS audit/review semantics instead of crashing the app.

### Field role boundary

Given a management role opens a visit on mobile,
when the detail loads,
then operational information may be reviewed but cleaning execution controls are not presented unless the current user is an actively assigned executable field role.

## Manual matrix after automated gates

Test at least: Android Expo Go; Android development build; iPhone development build; camera allow/deny/permanent deny; GPS allow/deny; airplane-mode start/checklist/photo/incident/stop/complete; reconnect with a forced sync conflict; app kill/reopen with pending work; account switch with and without pending work; expired/revoked mobile session; push foreground/background/terminated on native builds.
