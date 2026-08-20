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

So every request that *does* arrive at `GET /t/:slug/*` means one of two things:

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
cp .env.example .env      # set LINK_HOST and ADMIN_TOKEN
npm run admin:build       # builds the admin SPA into admin-dist/
npm start                 # http://localhost:3000  (+ /admin)
```

**Deployed**, it is a static site on Firebase Hosting — see [§3](#3-hosting-on-firebase-free-spark-plan):

```bash
npm run deploy            # build:static + tests + firebase deploy
```

So the workflow is: edit and preview locally in `/admin` → `npm run deploy` to publish.

| URL | What it is |
|---|---|
| `/t/:slug/*` | The link itself — platform-aware redirect or download page |
| `/.well-known/apple-app-site-association` | AASA, generated from `data/apps.json` |
| `/.well-known/assetlinks.json` | Digital Asset Links, generated from `data/apps.json` |
| `/admin` | Config UI — behavior matrix, icon upload, legacy codes |
| `/healthz` | Boot sanity: app count, AASA entries, assetlink statements |
| `/:code` | Legacy Branch short-code resolution |
| `/api/deeplink/{resolve,pending}` | Deferred deep-link contract stubs |

`data/apps.json` is the single source of truth. Both `.well-known` files are generated from
it on every request, so there is no separate publish step and no way for them to drift.

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

`npm run build:static` turns `data/apps.json` into `dist/`:

| Output | Notes |
|---|---|
| `.well-known/apple-app-site-association` | Generated, extensionless |
| `.well-known/assetlinks.json` | Generated |
| `t/<slug>/index.html` | One page per app; a Hosting rewrite points every path beneath it here |
| `qr.js` | Loaded only on desktop, and only for deep paths |
| `firebase.json` | **Generated** — rewrites and redirects derive from `apps.json` |

### The trade-off

There is no server, so **config changes require a redeploy**. The admin UI still runs
locally against `npm start` — edit behavior, upload icons, preview — then rebuild and deploy.
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

`npm run deploy` runs `build:static`, then `npm test` (the boot-script decision tests), then
deploys — so a bad redirect decision fails before it ships.

Verify the live site with `./scripts/verify.sh https://runloyal-link-poc.web.app`.

### Testing locally first

```bash
npm run build:static
firebase emulators:start --only hosting
```

The emulator honours `firebase.json` exactly — headers, rewrites and redirects included — so
it catches all three traps above before a deploy.

---

## 4. Behavior configuration

Per app, per platform, from `/admin`:

| Behavior | iOS / Android | Desktop |
|---|---|---|
| `interstitial` | Download page | Download page with QR |
| `storeDirect` | 302 to App Store / Play | Falls back to interstitial — there is no store |
| `portal` | 302 to the web portal | 302 to the web portal |

`crawler` and `inAppWebview` are deliberately **not** configurable:

- A crawler always gets meta tags and never a redirect. Slack, iMessage, WhatsApp and
  Facebook cache what they scrape; a 302 served to a crawler gets cached against the link
  and every preview stays wrong for weeks.
- An in-app webview always gets the interstitial, because that is the only surface where the
  "Open in browser" escape hatch can be shown — and Universal Links do not fire inside those
  webviews at all.

### `openAppIfInstalled` — off, and should stay off for now

**Opening an installed app straight from the browser is deferred.** The toggle and both
implementations are built and working, but they are switched off by default because they
need the app side to be able to receive a link, which has not shipped.

Turned on prematurely, iOS visitors get an "Open in …?" system prompt that leads nowhere —
strictly worse than going to the store. With it off, every visitor lands on the store or the
portal, which always works.

When the app side is ready, flipping it on gives:

- **Android** — an `intent://` URL with `S.browser_fallback_url`. Chrome resolves it
  natively: app if installed, Play Store if not. No timer, no error banner, no race.
- **iOS** — a `<scheme>://` probe with a ~1.2 s visibility timer before falling back to the
  App Store. Best-effort only, and bound to a real tap rather than firing on page load,
  because an unprompted scheme navigation reads as a hijack.

Note that neither is the *primary* mechanism even then — see the Overview. A link tapped
from Messages or Mail is intercepted by the OS before any request reaches this service.

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

`data/apps.json` currently carries each app's upload-key fingerprint plus the local debug
key, so debug builds verify during the PoC. **Both must be replaced with Play Console values
before anything ships.**

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

0. **Opening an installed app directly is deferred** — see [§4](#openappifinstalled--off-and-should-stay-off-for-now).
   What this PoC proves today is the web half: platform detection, the download page, and
   store / portal redirects. The `.well-known` files are still generated and served
   correctly, so the app-side half can be switched on later without touching this service.
1. **Admin auth is a single shared bearer token.** No user model, no audit trail, no
   rotation. Adequate behind a private tunnel and nothing more.
2. **`data/apps.json` is a file, not a database.** Writes are atomic (temp file + rename)
   and cached in-process, but there is no locking — concurrent admin writes from two
   processes would race. Single-process only.
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

- **AASA is capped at 128 KB by Apple.** At ~170 bytes per minified entry, 300 tenants land
  around 50–55 KB. Plan a second host (`link2.runloyal.com`) before ~550. `/admin` →
  well-known reports the live size; `verify.sh` fails the build past the limit and warns
  past 100 KB.
- **Path scoping is mandatory, not an optimisation.** Without per-tenant `components` /
  `pathPrefix`, any installed tenant app claims every path on the domain. Android 14 and
  below ignore server-side path rules entirely, so the manifest `pathPrefix` is what
  actually enforces this.
- **Add the AASA entry at flavor-creation time, not on release day.** Apple serves the file
  through its own CDN with no manual invalidation, so a tenant added on launch day can have
  links silently open Safari for days.
- **One malformed statement can invalidate an entire well-known file** and take every other
  tenant on that host down with it. Apps missing a fingerprint are omitted rather than
  emitted with an empty array, and the files are never hand-edited.
