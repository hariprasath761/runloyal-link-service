import { useRef, useState } from 'react';

import * as api from '../api.js';

/**
 * Per-app editor: identity, the behavior matrix, and icon upload.
 *
 * The slug is read-only. It is the path prefix baked into shipped binaries
 * (`pathPrefix` in the Android manifest, `components` in the AASA), so changing
 * it would silently break every installed copy of the app.
 */

const BEHAVIOR_HELP = {
  interstitial: 'Show the download page',
  storeDirect: 'Redirect straight to the store',
  portal: 'Redirect to the web portal',
};

export default function AppEditor({ app, behaviors, platforms, onSaved, onError }) {
  const [draft, setDraft] = useState(() => structuredClone(app));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  const set = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const setIos = (patch) => set({ ios: { ...draft.ios, ...patch } });
  const setAndroid = (patch) => set({ android: { ...draft.android, ...patch } });
  const setBehavior = (platform, value) =>
    set({ behavior: { ...draft.behavior, [platform]: value } });

  async function save() {
    setBusy(true);
    try {
      await api.updateApp(app.slug, draft);
      setSaved(true);
      onError('');
      await onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickIcon(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.uploadIcon(app.slug, file);
      set({ iconPath: res.iconPath });
      onError('');
      await onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>{draft.displayName}</h2>
        <div className="panel__actions">
          {saved ? <span className="saved">Saved</span> : null}
          <button className="btn btn--primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Identity ────────────────────────────────────────────────────── */}
      <div className="grid">
        <label className="field">
          <span>Slug</span>
          <input value={draft.slug} readOnly disabled />
          <small>Baked into shipped binaries — cannot be changed.</small>
        </label>

        <label className="field">
          <span>Display name</span>
          <input value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} />
        </label>

        <label className="field">
          <span>Headline</span>
          <input value={draft.tagline} onChange={(e) => set({ tagline: e.target.value })} />
          <small>Shown as the heading on the download page.</small>
        </label>

        <label className="field field--toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span>Enabled</span>
          <small>Disabling removes the app from both well-known files.</small>
        </label>
      </div>

      {/* ── Icon ────────────────────────────────────────────────────────── */}
      <h3>App icon</h3>
      <div className="iconrow">
        <div className="iconrow__preview">
          {draft.iconPath ? (
            <img src={draft.iconPath} alt="" />
          ) : (
            <span>{draft.displayName[0]}</span>
          )}
        </div>
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickIcon} />
          <small>
            PNG, JPEG or WebP, up to 512 KB. Square works best. This is the icon on the
            download page only — the installed app&rsquo;s launcher icon is set at build time.
          </small>
        </div>
      </div>

      {/* ── Behavior matrix ─────────────────────────────────────────────── */}
      <h3>What happens when the link is opened</h3>
      <div className="grid grid--3">
        {platforms.map((platform) => (
          <label className="field" key={platform}>
            <span>{platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : 'Desktop'}</span>
            <select
              value={draft.behavior[platform]}
              onChange={(e) => setBehavior(platform, e.target.value)}
            >
              {behaviors
                // There is no store to send a desktop browser to.
                .filter((b) => !(platform === 'desktop' && b === 'storeDirect'))
                .map((b) => (
                  <option key={b} value={b}>
                    {BEHAVIOR_HELP[b]}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>

      <label className="field field--toggle">
        <input
          type="checkbox"
          checked={draft.openAppIfInstalled}
          onChange={(e) => set({ openAppIfInstalled: e.target.checked })}
        />
        <span>Open the app directly when it is installed (not ready yet)</span>
      </label>
      <p className="note">
        <strong>Leave this off for now.</strong> It makes Android use an{' '}
        <code>intent:</code> URL and iOS try <code>{draft.ios.scheme || 'scheme'}://</code>{' '}
        before falling back to the store — but both need the app side to be able to receive
        the link, which is not shipped yet. Turned on early, iOS users get an
        &ldquo;Open in&nbsp;&hellip;?&rdquo; prompt that leads nowhere. With it off, every
        visitor goes to the store or the portal, which always works.
      </p>

      <label className="field">
        <span>Portal URL override</span>
        <input
          value={draft.portalUrlOverride || ''}
          placeholder="(uses the global portal URL)"
          onChange={(e) => set({ portalUrlOverride: e.target.value || null })}
        />
      </label>

      {/* ── Platform identity ───────────────────────────────────────────── */}
      <h3>iOS</h3>
      <div className="grid">
        <label className="field">
          <span>Bundle ID</span>
          <input value={draft.ios.bundleId} onChange={(e) => setIos({ bundleId: e.target.value })} />
        </label>
        <label className="field">
          <span>Apple Team ID</span>
          <input value={draft.ios.teamId} onChange={(e) => setIos({ teamId: e.target.value })} />
          <small>Required — the AASA entry is TEAMID.bundleId.</small>
        </label>
        <label className="field">
          <span>App Store ID</span>
          <input
            value={draft.ios.appStoreId || ''}
            onChange={(e) => setIos({ appStoreId: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Custom URL scheme</span>
          <input
            value={draft.ios.scheme || ''}
            onChange={(e) => setIos({ scheme: e.target.value })}
          />
          <small>Used by the fallback probe. Must match CFBundleURLSchemes.</small>
        </label>
      </div>

      <h3>Android</h3>
      <div className="grid">
        <label className="field">
          <span>Package name</span>
          <input
            value={draft.android.packageName}
            onChange={(e) => setAndroid({ packageName: e.target.value })}
          />
        </label>
        <label className="field field--wide">
          <span>SHA-256 certificate fingerprints</span>
          <textarea
            rows={4}
            value={draft.android.sha256CertFingerprints.join('\n')}
            onChange={(e) =>
              setAndroid({
                sha256CertFingerprints: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <small>
            One per line. Take these from <strong>Play Console → Release → Setup → App
            Signing</strong>, not a local keystore: Play re-signs the APK, so a local
            fingerprint verifies against nothing and App Links fail with no visible error.
            Include both the upload key and the Play signing key.
          </small>
        </label>
      </div>
    </section>
  );
}
