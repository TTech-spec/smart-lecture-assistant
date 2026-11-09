import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * QR code generated in the browser — no outside service, so it works on
 * campus networks that block third-party image sites, and offline.
 */
export function QrCode({ value, size = 240, className, alt }: { value: string; size?: number; className?: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark: "#121a2b", light: "#ffffff" } })
      .then((url) => { if (!cancelled) setSrc(url); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [value, size]);

  if (!src) return <div style={{ width: size, height: size }} className={`animate-pulse rounded bg-secondary ${className ?? ""}`} />;
  return <img src={src} width={size} height={size} alt={alt ?? "QR code"} className={className} />;
}
