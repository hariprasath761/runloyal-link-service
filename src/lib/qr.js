import QRCode from 'qrcode';

/**
 * Renders a QR code as an inline SVG string.
 *
 * Inline rather than an <img src> to an external generator: the interstitial
 * must render with no third-party requests at all. A remote QR service would
 * add a round trip on the critical path, leak every link URL to a third party,
 * and break the page whenever that service is down.
 */
export async function qrSvg(text, { margin = 0, width = 220 } = {}) {
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin,
      width,
      // 'M' tolerates ~15% damage. Enough for a screen-displayed code without
      // inflating module count (and therefore density) the way 'H' would.
      errorCorrectionLevel: 'M',
      color: { dark: '#0B1220', light: '#FFFFFF' },
    });
    // The generated SVG carries a fixed width/height; strip it so CSS controls
    // sizing and the code stays crisp at any container width.
    return svg
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace('<svg', '<svg preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"');
  } catch (err) {
    console.error('[qr] failed to render', err);
    return null;
  }
}
