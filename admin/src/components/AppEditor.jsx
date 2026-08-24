import { useRef, useState } from 'react';

import * as api from '../api.js';

/**
 * Per-app editor: identity, deterministic link workflow, and icon upload.
 *
 * The slug is read-only. It is the path prefix baked into shipped binaries
 * (`pathPrefix` in the Android manifest, `components` in the AASA), so changing
 * it would silently break every installed copy of the app.
 */

export default function AppEditor({ app, onSaved, onError }) {
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
  const setWeb = (patch) => set({ web: { ...draft.web, ...patch } });

  const publishMissing = [
    !draft.ios.bundleId?.trim() && 'iOS bundle ID',
    !draft.ios.teamId?.trim() && 'Apple Team ID',
    !draft.ios.appStoreId?.trim() && 'App Store ID',
    !draft.android.packageName?.trim() && 'Android package name',
    draft.android.sha256CertFingerprints.length === 0 && 'Android SHA-256 signing fingerprint',
  ].filter(Boolean);

  const nativeMissing = [
    !draft.enabled && 'Publish the app configuration',
    !draft.ios.bundleId?.trim() && 'iOS bundle ID',
    !draft.ios.teamId?.trim() && 'Apple Team ID',
    !draft.android.packageName?.trim() && 'Android package name',
    draft.android.sha256CertFingerprints.length === 0 && 'Android SHA-256 signing fingerprint',
  ].filter(Boolean);

  function setEnabled(next) {
    if (next && publishMissing.length) {
      onError(`Complete these requirements before publishing:\n${publishMissing.join('\n')}`);
      return;
    }
    onError('');
    set({
      enabled: next,
      nativeDeepLinkEnabled: next ? draft.nativeDeepLinkEnabled : false,
    });
  }

  function setNativeDeepLinks(next) {
    if (next && nativeMissing.length) {
      onError(`Complete these requirements before enabling open app when installed:\n${nativeMissing.join('\n')}`);
      return;
    }
    onError('');
    set({ nativeDeepLinkEnabled: next });
  }

  function setWebUrl(value) {
    const url = value.trim() ? value : null;
    set({
      web: {
        ...draft.web,
        url,
        showLink: url ? draft.web.showLink : false,
        redirectDesktop: url ? draft.web.redirectDesktop : false,
      },
    });
  }

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

        <div className="field">
          <span>Publishing status</span>
          <div className="status-toggle" role="group" aria-label="Publishing status">
            <button
              type="button"
              className={!draft.enabled ? 'status-toggle__btn status-toggle__btn--active' : 'status-toggle__btn'}
              onClick={() => setEnabled(false)}
            >
              Draft
            </button>
            <button
              type="button"
              className={draft.enabled ? 'status-toggle__btn status-toggle__btn--active' : 'status-toggle__btn'}
              onClick={() => setEnabled(true)}
            >
              Published
            </button>
          </div>
          <small>Published apps are live. Draft apps remain editable but cannot claim links.</small>
        </div>
      </div>

      <div className={publishMissing.length ? 'readiness-card readiness-card--pending' : 'readiness-card readiness-card--ready'}>
        <strong>{publishMissing.length ? 'Publishing requirements' : 'Ready to publish'}</strong>
        {publishMissing.length ? (
          <ul>{publishMissing.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : (
          <p>Both iOS and Android association details are complete.</p>
        )}
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

      {/* ── Mobile workflow ─────────────────────────────────────────────── */}
      <h3>iOS and Android link workflow</h3>
      <p className="note">
        Mobile links never redirect to the app&rsquo;s web URL. The operating system opens a
        compatible installed app only when native opening is enabled; every request that reaches
        this service goes to the correct platform store.
      </p>
      <div className="workflow-grid">
        {['iOS', 'Android'].map((platform) => (
          <div className="workflow-card" key={platform}>
            <strong>{platform}</strong>
            <div><span>App not installed</span><b>Open {platform === 'iOS' ? 'App Store' : 'Play Store'}</b></div>
            <div>
              <span>App installed</span>
              <b>{draft.nativeDeepLinkEnabled ? 'Open app' : `Open ${platform === 'iOS' ? 'App Store' : 'Play Store'}`}</b>
            </div>
          </div>
        ))}
      </div>

      <h3>Web experience</h3>
      <label className="field">
        <span>Individual web URL</span>
        <input
          type="url"
          value={draft.web.url || ''}
          placeholder="https://tenant.example.com"
          onChange={(e) => setWebUrl(e.target.value)}
        />
        <small>This exact URL is used. Universal-link paths are not appended.</small>
      </label>
      <div className="toggle-stack">
        <label className="field field--toggle">
          <input
            type="checkbox"
            checked={draft.web.showLink}
            disabled={!draft.web.url}
            onChange={(e) => setWeb({ showLink: e.target.checked })}
          />
          <span>Show “Continue on web” on every landing page</span>
        </label>
        <label className="field field--toggle">
          <input
            type="checkbox"
            checked={draft.web.redirectDesktop}
            disabled={!draft.web.url}
            onChange={(e) => setWeb({ redirectDesktop: e.target.checked })}
          />
          <span>Redirect desktop browsers directly to web</span>
          <small>Off by default. When off, desktop visitors see the QR/download page.</small>
        </label>
      </div>

      <label className="field field--toggle">
        <input
          type="checkbox"
          checked={draft.nativeDeepLinkEnabled}
          onChange={(e) => setNativeDeepLinks(e.target.checked)}
        />
        <span>Enable open app when installed</span>
      </label>
      <div className={nativeMissing.length ? 'readiness-card readiness-card--pending' : 'readiness-card readiness-card--ready'}>
        <strong>
          {nativeMissing.length
            ? 'Native association requirements'
            : draft.nativeDeepLinkEnabled
              ? 'Native opening is active'
              : 'Compatible releases are ready for activation'}
        </strong>
        {nativeMissing.length ? (
          <ul>{nativeMissing.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : (
          <p>
            This shared switch publishes both AASA and Android association statements.
            Enable it shortly before installing the compatible TestFlight and internal-track builds.
          </p>
        )}
      </div>

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
