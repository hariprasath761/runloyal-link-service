# Flutter Native Link Integration for an Individual App

This document describes how to connect one independently released Flutter app to the
RunLoyal Link Service using iOS Universal Links and Android App Links.

Each Flutter repository represents one application and has one fixed link slug, iOS bundle
ID, Android application ID, App Store ID, and signing identity.

## 1. Integration values

Collect these values before changing the Flutter application:

| Value | Example |
|---|---|
| Link host | `runloyal-link-poc.web.app` |
| App slug | `kennel` |
| Canonical base link | `https://runloyal-link-poc.web.app/app/kennel` |
| iOS bundle ID | `com.itrustkennel.staffapp.plus.kennel` |
| Apple Team ID | `E8Q47GVS49` |
| App Store ID | The numeric App Store Connect ID |
| Android application ID | `com.itrustkennel.staffapp.plus.kennel` |
| Android SHA-256 | Play App Signing certificate fingerprint |

Replace the example slug and identifiers with the values belonging to the individual app.
The slug is permanent after links are released.

The supported URL structure is:

```text
https://<link-host>/app/<app-slug>
https://<link-host>/app/<app-slug>/<route>/<identifier>
```

Example:

```text
https://runloyal-link-poc.web.app/app/kennel/appointment/123
```

## 2. Expected behavior

The Flutter application must not use timers, custom schemes, Android `intent:` URLs, or an
"is app installed" check.

The operating system owns the installed-app decision:

| Situation | Result |
|---|---|
| Compatible app installed and native opening enabled | The operating system opens the app |
| App not installed | The link service redirects to App Store or Play Store |
| Native opening disabled in admin | The link service redirects mobile traffic to the store |
| Desktop browser | Landing page, or the app's configured desktop web URL |
| In-app webview | Landing page with an Open in browser action |

The link service receives no HTTP request when the operating system successfully opens the
installed application.

## 3. Android App Links

### 3.1 Confirm the application ID

In `android/app/build.gradle` or `android/app/build.gradle.kts`, confirm that the production
application ID matches the value entered in the Link Service admin portal.

Groovy example:

```groovy
android {
    defaultConfig {
        applicationId "com.itrustkennel.staffapp.plus.kennel"
    }
}
```

Kotlin DSL example:

```kotlin
android {
    defaultConfig {
        applicationId = "com.itrustkennel.staffapp.plus.kennel"
    }
}
```

### 3.2 Add exact and nested HTTPS intent filters

Open `android/app/src/main/AndroidManifest.xml`. Inside the existing `.MainActivity`
element, keep the Flutter launcher intent filter and add the following two filters.

Replace `kennel` with this app's fixed Link Service slug.

```xml
<activity
    android:name=".MainActivity"
    android:exported="true"
    android:launchMode="singleTop"
    android:theme="@style/LaunchTheme"
    android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
    android:hardwareAccelerated="true"
    android:windowSoftInputMode="adjustResize">

    <!-- Keep the existing Flutter launcher intent filter. -->

    <!-- Exact tenant link: /app/kennel -->
    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />

        <data android:scheme="http" />
        <data android:scheme="https" />
        <data
            android:host="runloyal-link-poc.web.app"
            android:path="/app/kennel" />
    </intent-filter>

    <!-- Nested tenant links: /app/kennel/... -->
    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />

        <data android:scheme="http" />
        <data android:scheme="https" />
        <data
            android:host="runloyal-link-poc.web.app"
            android:pathPrefix="/app/kennel/" />
    </intent-filter>
</activity>
```

The exact and nested paths are deliberately separate. The trailing slash on
`android:pathPrefix` prevents a slug such as `kennel` from matching a different app such as
`kennel-plus`.

Do not claim the whole link host. This host is shared by multiple independently installed
tenant apps.

### 3.3 Add the production signing fingerprint in admin

Find the production SHA-256 certificate under:

```text
Play Console → Setup → App integrity → App signing
```

Enter the **App signing key certificate** SHA-256 value in the Link Service admin portal.
Play signs the delivered application, so an upload-key or local debug fingerprint alone is
not sufficient for production verification.

Add additional fingerprints only when the corresponding build must be tested, such as a
debug certificate. Remove test fingerprints when they are no longer required.

## 4. iOS Universal Links

### 4.1 Confirm the application identity

Open `ios/Runner.xcworkspace` in Xcode and confirm:

- Runner's bundle identifier matches the admin portal.
- The selected Apple development team matches the configured Team ID.
- The numeric App Store ID is correct in the admin portal.

### 4.2 Add Associated Domains

In Xcode:

1. Select the Runner project.
2. Select the Runner target.
3. Open **Signing & Capabilities**.
4. Select **+ Capability**.
5. Add **Associated Domains**.
6. Add this value:

```text
applinks:runloyal-link-poc.web.app
```

Do not include `https://`, `/app/kennel`, a port, query parameters, or a trailing slash.
Tenant path isolation is defined by the AASA file generated by the Link Service.

The resulting `ios/Runner/Runner.entitlements` should contain:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.associated-domains</key>
    <array>
        <string>applinks:runloyal-link-poc.web.app</string>
    </array>
</dict>
</plist>
```

### 4.3 Update Apple signing

Associated Domains must be enabled for the application identifier in the Apple Developer
portal. Regenerate the development, Ad Hoc, and App Store provisioning profiles after
enabling it.

Verify the Release configuration uses `Runner.entitlements` through the
`CODE_SIGN_ENTITLEMENTS` build setting. A capability visible only in a debug build will not
work in TestFlight or the App Store release.

## 5. Flutter route handling

Flutter's Router API receives both cold-start and warm-app deep links. `go_router`, maintained
by the Flutter team, is the recommended way to connect those links to application screens.

If the app does not already use `go_router`:

```bash
flutter pub add go_router
```

Define the link host and slug as fixed constants belonging to this individual app:

```dart
const linkHost = 'runloyal-link-poc.web.app';
const linkSlug = 'kennel';
```

The following example validates the host and tenant before mapping the remaining path into
the native application router:

```dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

const linkHost = 'runloyal-link-poc.web.app';
const linkSlug = 'kennel';

String? handleIncomingLink(GoRouterState state) {
  final uri = state.uri;
  final segments = uri.pathSegments;

  // This is a normal internal Flutter route, not an incoming service link.
  if (segments.isEmpty || segments.first != 'app') {
    return null;
  }

  // Reject malformed or wrong-tenant URLs.
  if (segments.length < 2 || segments[1] != linkSlug) {
    return '/';
  }

  // Flutter can provide an absolute or relative URI depending on launch state.
  // Validate the origin whenever the absolute origin is available.
  if (uri.hasScheme &&
      (uri.scheme != 'https' || uri.host != linkHost)) {
    return '/';
  }

  final remaining = segments.skip(2).toList(growable: false);

  // A bare tenant link opens the app home.
  if (remaining.isEmpty) {
    return '/';
  }

  // Example: /app/kennel/appointment/123
  if (remaining.length == 2 &&
      remaining[0] == 'appointment' &&
      remaining[1].isNotEmpty) {
    final appointmentId = Uri.encodeComponent(remaining[1]);
    return '/appointments/$appointmentId';
  }

  // Unknown routes must fail safely and never crash the application.
  return '/';
}

final router = GoRouter(
  initialLocation: '/',
  redirect: (context, state) => handleIncomingLink(state),
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
    ),
    GoRoute(
      path: '/appointments/:appointmentId',
      builder: (context, state) {
        final appointmentId = state.pathParameters['appointmentId']!;
        return AppointmentScreen(appointmentId: appointmentId);
      },
    ),
  ],
);

void main() {
  runApp(
    MaterialApp.router(
      routerConfig: router,
    ),
  );
}
```

Extend `handleIncomingLink` for every supported application route. Keep all business screen
mapping inside the Flutter app; the Link Service treats everything after `/app/<slug>/` as
opaque.

The handler must always:

- accept the exact app slug only;
- open home for a bare tenant link;
- open home for unknown routes;
- reject malformed and wrong-tenant links;
- check collection lengths before accessing path segments;
- validate identifiers before using them in API requests;
- handle both unauthenticated and authenticated application state;
- save a pending destination when login is required, then continue after login;
- never crash because of invalid link input.

### Plugin compatibility

Prefer Flutter's built-in deep-link delivery with `MaterialApp.router`. If the application
already uses a third-party plugin such as `app_links`, do not run both handlers. Disable
Flutter's default handler exactly as documented by Flutter and ensure the plugin processes
both its initial URI and URI stream.

## 6. Link Service admin configuration

For this individual application:

1. Open `/admin` on the Link Service deployment.
2. Create or select the app record.
3. Use exactly the slug hardcoded in Android and Flutter.
4. Enter the iOS bundle ID, Team ID, and App Store ID.
5. Enter the Android application ID and Play App Signing SHA-256 fingerprint.
6. Publish the app configuration.
7. Keep **Enable open app when installed** off until compatible builds are uploaded.

Enabling the switch publishes both the iOS AASA entry and Android Digital Asset Links
statement. It activates iOS and Android together, so both releases must be ready.

## 7. Release sequence

Use this sequence to avoid releasing an app that cannot claim the links:

1. Complete Android manifest, iOS entitlement, and Flutter routing changes.
2. Upload the Android build to a Play internal testing track.
3. Upload the iOS build to TestFlight.
4. Confirm production identifiers and signing fingerprints in Link Service admin.
5. Publish the app configuration if it is still a draft.
6. Enable **Enable open app when installed** shortly before clean installation testing.
7. Confirm the association files contain the application.
8. Clean-install the internal-track and TestFlight builds.
9. Complete the acceptance tests below.
10. Release both compatible builds publicly.

Do not enable native opening for an old production build that does not contain the Android
intent filters or iOS Associated Domains entitlement.

## 8. Verify the hosted association files

Check iOS:

```bash
curl -i \
  https://runloyal-link-poc.web.app/.well-known/apple-app-site-association
```

The application should appear as `<TEAM_ID>.<BUNDLE_ID>` with these paths:

```text
/app/kennel
/app/kennel/*
```

Check Android:

```bash
curl -i \
  https://runloyal-link-poc.web.app/.well-known/assetlinks.json
```

Confirm the production package name and Play App Signing fingerprint appear exactly.
Both endpoints must return HTTP 200 directly, use `application/json`, and have no redirect.

## 9. Android acceptance tests

Install the Play internal-track build. Wait at least 20 seconds for domain verification, then
run:

```bash
adb shell pm verify-app-links --re-verify \
  com.itrustkennel.staffapp.plus.kennel

adb shell pm get-app-links \
  com.itrustkennel.staffapp.plus.kennel
```

Test the base link:

```bash
adb shell am start -W \
  -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "https://runloyal-link-poc.web.app/app/kennel"
```

Test a nested link:

```bash
adb shell am start -W \
  -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "https://runloyal-link-poc.web.app/app/kennel/appointment/123"
```

Also tap the links from Messages, Gmail, or another application. Test with the app terminated
and with it already running in the background.

## 10. iOS acceptance tests

Use the TestFlight-installed application on a physical device:

1. Terminate the app.
2. Send the base and nested URLs through Messages or Mail.
3. Tap the base URL and confirm the app opens home.
4. Tap the nested URL and confirm the correct screen opens.
5. Background the app and tap another link to test warm navigation.
6. Test an unknown route and confirm it opens home without crashing.
7. Test a link for a different tenant and confirm this app does not claim it.
8. Uninstall the app and confirm the same link falls back to the App Store.

Typing or pasting a Universal Link into Safari may remain in Safari. Tapping a same-domain
link while already browsing that domain may also remain in Safari. These are platform rules,
not an app failure.

## 11. Production acceptance checklist

- [ ] Android application ID matches Link Service admin.
- [ ] Play App Signing SHA-256 matches `assetlinks.json`.
- [ ] Android has separate exact and nested intent filters.
- [ ] Android filters use `autoVerify`, `DEFAULT`, and `BROWSABLE`.
- [ ] iOS bundle ID and Team ID match Link Service admin.
- [ ] Associated Domains is present in the signed Release entitlement.
- [ ] App Store provisioning profile was regenerated after capability changes.
- [ ] Flutter validates host and exact tenant slug.
- [ ] Bare links open home.
- [ ] Known nested links open the correct screen.
- [ ] Unknown or malformed links open home without crashing.
- [ ] Cold-start and warm-app navigation work on both platforms.
- [ ] Wrong-tenant links are not claimed.
- [ ] Uninstalled iOS falls back to App Store.
- [ ] Uninstalled Android falls back to Play Store.
- [ ] Native opening is enabled only after both compatible builds are ready.

## Official references

- [Flutter deep linking](https://docs.flutter.dev/ui/navigation/deep-linking)
- [Flutter: Set up Android App Links](https://docs.flutter.dev/cookbook/navigation/set-up-app-links)
- [Flutter: Set up iOS Universal Links](https://docs.flutter.dev/cookbook/navigation/set-up-universal-links)
- [Android: Add App Link intent filters](https://developer.android.com/training/app-links/add-applinks)
- [Android: Test App Links](https://developer.android.com/training/app-links/test-applinks)
- [Apple: Supporting Associated Domains](https://developer.apple.com/documentation/Xcode/supporting-associated-domains)
- [Apple: Debugging Universal Links](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links)
