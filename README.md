# RunLoyal Link Service

Native deep linking — iOS Universal Links + Android App Links — replacing Branch.io.

This is the PoC that gates the pet-owner migration. It runs the two staff apps in
`staff-turbo-flutter` (**kennel** and **groomers**) end to end: one URL that opens the
installed app directly, falls through to the right store when it is not installed, and
renders a branded download page everywhere else.

---

## Overview

The counterintuitive part, and the thing most implementations get backwards: **when deep
linking is working correctly, this server never runs.**

A Universal Link or App Link tapped from Messages, Mail, or another native app is
intercepted by the operating system before any network request is made. The OS has already
downloaded `/.well-known/apple-app-site-association` (iOS, at install and periodically) or
`/.well-known/assetlinks.json` (Android, at install) and knows which app owns that URL. It
opens the app. No HTTP request reaches this service at all.

So every request that *does* arrive at `GET /app/:slug/*` means one of two things:

1. the app is not installed, or
2. the link was opened somewhere Universal Links do not fire — pasted into Chrome's address
   bar, inside an Instagram/WhatsApp/Gmail webview, or on iOS after the user once chose
   "open in Safari" for this domain, which latches a declined flag until they long-press and
   pick *Open in App*.

Everything this service renders is for those two cases. The primary mechanism is entirely a
function of serving two JSON files correctly — which is why [§2](#2-serving-requirements)
matters more than any other section here.

> **Every requirement in §2 fails silently.** There is no error in Xcode, in logcat, or in
> this server's log. The only symptom is links opening the browser instead of the app —
> indistinguishable from "the app is not installed".

---

## 1. Running it

Two modes, and they are not alternatives — you use both.

**Locally**, the full Express app runs, so the admin UI can save config and upload icons:

```bash
npm install
cp .env.example .env      # set LINK_HOST, Supabase Auth, and ADMIN_EMAILS
npm run admin:build       # builds the admin SPA into admin-dist/
npm start                 # http://localhost:3000 redirects to /admin
```

**Deployed**, it is a static site on Firebase Hosting — see [§3](#3-hosting-on-firebase-free-spark-plan):

```bash
npm run deploy            # build:static + tests + firebase deploy
```

So the workflow is: edit and preview locally in `/admin` → `npm run deploy` to publish.

| URL | What it is |
|---|---|
| `/app/:slug/*` | Canonical app link — native interception or platform fallback |
| `/t/:slug/*` | Compatibility redirect for links issued before `/app` |
| `/.well-known/apple-app-site-association` | AASA, generated from Supabase app records |
| `/.well-known/assetlinks.json` | Digital Asset Links, generated from Supabase app records |
| `/admin` | Email/password admin UI — apps, publishing, links, and icon upload |
| `/healthz` | Boot sanity: app count, AASA entries, assetlink statements |
| `/:code` | Legacy Branch short-code resolution |
| `/api/deeplink/{resolve,pending}` | Deferred deep-link contract stubs |

Supabase is the only source of truth. The server refuses to start when its PostgreSQL
connection variables are missing; it never falls back to a local configuration file. Both
`.well-known` files use the same repository as the admin API, so there is no separate
configuration that can drift.

Admin login always uses Supabase Auth, even when app configuration is stored in JSON. Create
the admin users under **Supabase → Authentication → Users**, set `SUPABASE_URL` and
`SUPABASE_ANON_KEY`, and put the permitted addresses in the comma-separated `ADMIN_EMAILS`
environment variable. The browser receives short-lived access and refresh tokens; no shared
admin secret is pasted into the UI.

Apply schema migrations:

```bash
npm run migrate:supabase
```

---

## 2. Serving requirements

These are not best practices; they are the specification, and violating any one of them
breaks deep linking with no visible error.

| Requirement | Why |
|---|---|
| HTTPS, publicly trusted cert | Neither platform will fetch over http |
| `Content-Type: application/json` | A `text/plain` response is ignored |
| **Zero redirects** — not even a trailing-slash 301 | Both platforms treat any redirect as a hard failure |
| No auth, no VPN, no IP allowlist | Apple fetches through its own CDN, from its own network |
| AASA has **no** `.json` extension | Apple requests the extensionless path |
| Proxy passes `.well-known` through unrewritten | A `ProxyPass !` rule ahead of it has caused this exact outage before |

[`src/server.js`](src/server.js) mounts the well-known router **first**, ahead of every
other middleware, and disables Express's trailing-slash redirect. Do not reorder it.

Verify with:

```bash
./scripts/verify.sh https://your-host
```

which asserts status 200, redirect count 0, `application/json`, valid JSON, and a non-empty
entry list — that last one catching an empty-file deploy, which otherwise looks perfectly
healthy.

---

## 3. Hosting on Firebase (free Spark plan)

Deployed as a **static site**. Firebase Hosting gives a stable HTTPS hostname
(`<project>.web.app`) with a real certificate and no interstitial warning page — which is
exactly what Universal Links and App Links need, and what a tunnel struggles to provide.

`npm run build:static` turns the current Supabase configuration into `dist/`:

| Output | Notes |
|---|---|
| `.well-known/apple-app-site-association` | Generated, extensionless |
| `.well-known/assetlinks.json` | Generated |
| `app/<slug>/index.html` | One page per app; a Hosting rewrite points every path beneath it here |
| `qr.js` | Loaded only on desktop, and only for deep paths |
| `firebase.json` | **Generated** — rewrites and redirects derive from `apps.json` |

### The trade-off

There is no server, so **config changes require a redeploy**. The admin UI still runs
locally against `npm start` — edit configuration, upload icons, preview — then rebuild and deploy.
The admin is deliberately *not* deployed: without an API it could not save anything, and a
UI whose Save button silently fails is worse than no UI.

One thing genuinely improves: crawlers get correct behavior for free. Bots do not run
JavaScript, so they receive the page with its OG tags and are never redirected. The dynamic
version had to sniff user agents to achieve the same thing.

### Three Firebase traps, all handled in the generated `firebase.json`

> Every one of these produces a working-looking deploy where deep linking silently does
> nothing.

1. **`"ignore": ["**/.*"]`** — what `firebase init` writes by default. It matches the
   `.well-known` **directory** and drops both association files from the deploy entirely.
2. **`"appAssociation": "AUTO"`** — the default. Firebase generates its own AASA for Dynamic
   Links and shadows yours. Must be `"NONE"`.
3. **Extensionless `Content-Type`** — `apple-app-site-association` has no file extension, so
   Hosting serves it as `application/octet-stream` and iOS ignores it. Needs an explicit
   `headers` rule.

`cleanUrls` and `trailingSlash` are both off for the same reason: each one adds redirects,
and *any* redirect on a `.well-known` path is a hard failure.

### Deploying

```bash
firebase login
firebase projects:create runloyal-link-poc     # or use an existing project
# set LINK_HOST=runloyal-link-poc.web.app in .env, then:
npm run deploy                                  # build + test + firebase deploy
```

`npm run deploy` runs `build:static`, then `npm test` (schema, API, server-routing, and
boot-script decision tests), then deploys — so a bad redirect decision fails before it ships.

Verify the live site with `./scripts/verify.sh https://runloyal-link-poc.web.app`.

### Testing locally first

```bash
npm run build:static
firebase emulators:start --only hosting
```

The emulator honours `firebase.json` exactly — headers, rewrites and redirects included — so
it catches all three traps above before a deploy.

---

## 4. Link workflow configuration

Each app owns its web destination; there is no common portal fallback. New apps are created
as disabled drafts in `/admin` and can be published only after the iOS bundle/team/store
details and Android package/signing fingerprint are complete.

Mobile behavior is intentionally deterministic. If native opening is enabled and a compatible
app is installed, iOS or Android opens it before the service receives a request. Otherwise,
iOS goes to the App Store and Android goes to Play. There is no mobile web-URL redirect choice.

Desktop renders the download page with its QR unless **Redirect desktop browsers directly
to web** is enabled for that app. **Show Continue on web** independently adds the exact
per-app URL to every rendered landing page. Both controls are off by default, and deep-link
paths are not appended to the web URL.

`crawler` and `inAppWebview` are deliberately **not** configurable:

- A crawler always gets meta tags and never a redirect. Slack, iMessage, WhatsApp and
  Facebook cache what they scrape; a 302 served to a crawler gets cached against the link
  and every preview stays wrong for weeks.
- An in-app webview always gets the interstitial, because that is the only surface where the
  "Open in browser" escape hatch can be shown — and Universal Links do not fire inside those
  webviews at all. Its optional "Continue on web" action follows the app's show-link toggle.

### Production native opening

The admin option **Enable open app when installed** controls `nativeDeepLinkEnabled`, a shared,
default-off release gate for iOS and Android. When it
is off, the app stays out of both association files and every request follows its normal
store fallback. When it is on, qualifying links are intercepted by the OS and delivered
to a compatible installed app before this service receives a request.

This service deliberately does not use custom URL schemes, Android `intent:` redirects,
timers, or automatic browser launch attempts. Typing or pasting a URL into a browser remains
a browser navigation. The admin switch must be enabled only when both compatible native
builds are ready.

#### Native release contract

For the complete individual Flutter application setup and release checklist, see
[Flutter Native Link Integration](docs/flutter-native-link-integration.md).

The iOS build must:

- include `applinks:<LINK_HOST>` in Associated Domains and use a regenerated provisioning
  profile;
- handle Universal Links on both cold launch and while the app is running;
- validate the host and `/app/<slug>` tenant prefix before passing the remaining path to the
  app router.

The Android build must:

- declare verified HTTPS intent filters with `android:autoVerify="true"`, `DEFAULT`, and
  `BROWSABLE`;
- use separate exact `/app/<slug>` and subtree `/app/<slug>/` filters so one tenant slug cannot
  match another tenant with the same prefix;
- handle both the initial intent and new intents delivered to a running activity.

Both apps open home for a bare or unknown route, reject malformed or wrong-tenant URLs, and
must never crash on invalid link input. Screen mapping stays inside the native app; the link
service treats the remaining path as opaque.

Because current releases do not claim this host, enable the association switch shortly
before installing the compatible TestFlight/internal-track builds, verify clean-install and
warm-app links, and then release those builds publicly. Publishing the association first
avoids install-time verification and Apple CDN cache delays without affecting old versions.

Release acceptance must cover the base link and a nested link on both a clean launch and a
running app. On iOS, tap the links from Messages or Mail and confirm that typing the same URL
in Safari stays in Safari. On an Android internal-track build, also verify domain state and
launch routing with:

```bash
adb shell pm verify-app-links --re-verify <package-name>
adb shell pm get-app-links <package-name>
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://<link-host>/app/<slug>/appointment/123"
```

After uninstalling each app, the same links must return to its platform store. Embedded
in-app browsers remain on the landing page so they can show an “Open in browser” escape hatch.

---

## 5. Fingerprints — the most common silent failure

The SHA-256 in `assetlinks.json` must come from **Play Console → Release → Setup → App
Signing**, not from a local keystore.

Play App Signing re-signs the APK. A fingerprint taken from the upload keystore verifies
against nothing, and App Links fail with no error surfaced anywhere. Include **both** the
upload key and the Play signing key.

For local testing with `flutter run`, the debug keystore's fingerprint is what matters:

```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android | grep SHA256
```

Only fingerprints saved in Supabase are published. Remove temporary debug or upload-key
fingerprints when they are no longer needed and always retain the Play App Signing value for
production.

---

## 6. The four places the host must agree

Nothing checks these against each other, and a mismatch fails silently.

| Where | Value |
|---|---|
| This service | `LINK_HOST` in `.env` |
| Android | `-Plink.host=…` → `manifestPlaceholders["linkHost"]` → `android:host` |
| iOS | `applinks:…` in `Runner.entitlements` |
| Dart | `--dart-define=LINK_HOST=…` → `StaffAppConfig.linkHost` |

```bash
flutter build apk --release \
  -Plink.host=link.runloyal.com \
  --dart-define=LINK_HOST=link.runloyal.com
```

iOS additionally requires the **Associated Domains** capability enabled on the App ID in the
Apple Developer portal, with provisioning profiles regenerated afterwards. Both staff apps
sit under Team `E8Q47GVS49`.

---

## 7. Known limits (PoC scope)

1. **Admin authorization is an email allowlist.** Supabase Auth handles passwords and token
   rotation, but roles and an audit trail are not yet implemented.
2. **Supabase availability is required.** The service fails explicitly when database settings
   are missing and returns an error during a database outage; it never serves a stale local
   copy of app configuration.
3. **Deferred deep linking is stubbed.** `/api/deeplink/resolve` and `/pending` return the
   right shape so the pet-owner apps can be written against them, but no Flutter-side Play
   Install Referrer read or post-auth iOS lookup exists. The referrer API does not work on
   debug APKs, so building it would require a Play internal-track release.
4. **Store badge artwork is a local recreation**, not Apple's and Google's official assets.
   Replace with the official downloads before anything user-facing — both have brand
   guidelines governing the badges.
5. **No rate limiting** on the redirect or admin endpoints.

---

## 8. Scaling notes for the 300-app migration

- **AASA is capped at 128 KB by Apple.** With exact and subtree path components, each entry
  adds about 267 bytes and 300 tenants land around 78 KB. Plan a second host
  (`link2.runloyal.com`) before the 100 KB warning at roughly 380 tenants. `/admin` →
  the admin API reports the live size; `verify.sh` fails the build past the limit and warns
  past 100 KB.
- **Path scoping is mandatory, not an optimisation.** Without per-tenant `components` /
  `pathPrefix`, any installed tenant app claims every path on the domain. Android 14 and
  below ignore server-side path rules entirely, so the manifest path filters are what
  actually enforces this.
- **Add the AASA entry at flavor-creation time, not on release day.** Apple serves the file
  through its own CDN with no manual invalidation, so a tenant added on launch day can have
  links silently open Safari for days.
- **One malformed statement can invalidate an entire well-known file** and take every other
  tenant on that host down with it. Apps missing a fingerprint are omitted rather than
  emitted with an empty array, and the files are never hand-edited.
