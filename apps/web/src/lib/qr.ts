import "server-only";
import QRCode from "qrcode";

/**
 * Render a QR code as a base64 data URL. Cached at render time on the server
 * page; the page is dynamic but QR generation is cheap (<5ms).
 */
export async function qrDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content, {
    margin: 1,
    width: 512,
    errorCorrectionLevel: "M",
    color: {
      dark: "#0a0a0a",
      light: "#ffffff",
    },
  });
}
