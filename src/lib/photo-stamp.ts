import type { Coords } from "@/lib/geo";

const GEOAPIFY_API_KEY = import.meta.env.VITE_GEOAPIFY_API_KEY as string | undefined;

export type StampInfo = {
  address: string;
  temperatureC: number | null;
  weather: string;
  takenAt: Date;
};

/** Reverse-geocode coordinates into a readable street address. */
export async function reverseGeocode(pos: Coords): Promise<string> {
  try {
    if (GEOAPIFY_API_KEY) {
      const r = await fetch(
        `https://api.geoapify.com/v1/geocode/reverse?lat=${pos.lat}&lon=${pos.lng}&apiKey=${GEOAPIFY_API_KEY}`,
      );
      if (r.ok) {
        const d = await r.json();
        const f = d?.features?.[0]?.properties;
        if (f?.formatted) return f.formatted as string;
      }
    }
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${pos.lat}&lon=${pos.lng}`,
    );
    if (r.ok) {
      const d = await r.json();
      if (d?.display_name) return d.display_name as string;
    }
  } catch {
    /* fall through */
  }
  return `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
}

const WEATHER_CODES: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Clouds",
  45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
  61: "Rain", 63: "Rain", 65: "Heavy rain", 80: "Showers", 81: "Showers",
  82: "Heavy showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
};

/** Current outdoor temperature + condition for the coordinates (Open-Meteo, no key). */
export async function currentWeather(pos: Coords): Promise<{ temperatureC: number | null; weather: string }> {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lng}&current=temperature_2m,weather_code`,
    );
    if (r.ok) {
      const d = await r.json();
      const t = d?.current?.temperature_2m;
      const code = d?.current?.weather_code;
      return {
        temperatureC: typeof t === "number" ? t : null,
        weather: WEATHER_CODES[code as number] ?? "—",
      };
    }
  } catch {
    /* ignore */
  }
  return { temperatureC: null, weather: "—" };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draws a small OpenStreetMap thumbnail centred on the position with a red pin. */
async function drawMiniMap(ctx: CanvasRenderingContext2D, pos: Coords, x: number, y: number, size: number) {
  const z = 16;
  const n = 2 ** z;
  const xt = ((pos.lng + 180) / 360) * n;
  const latRad = (pos.lat * Math.PI) / 180;
  const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.floor(xt);
  const ty = Math.floor(yt);
  const px = (xt - tx) * 256; // pin position inside centre tile
  const py = (yt - ty) * 256;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x, y, size, size);

  // 3x3 tiles around the centre, scaled so 256px tile -> size*0.75
  const scale = (size * 0.75) / 256;
  const tiles: Promise<void>[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      tiles.push(
        loadImage(`https://tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png`).then((img) => {
          if (!img) return;
          const ox = x + size / 2 - px * scale + dx * 256 * scale;
          const oy = y + size / 2 - py * scale + dy * 256 * scale;
          ctx.drawImage(img, ox, oy, 256 * scale, 256 * scale);
        }),
      );
    }
  }
  await Promise.all(tiles);

  // Pin
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.09;
  ctx.fillStyle = "#ea4335";
  ctx.beginPath();
  ctx.arc(cx, cy - r * 1.6, r, Math.PI, 0);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#7f1d1d";
  ctx.beginPath();
  ctx.arc(cx, cy - r * 1.6, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/**
 * Takes a captured frame and returns a JPEG data URL with a GPS-camera-style
 * stamp: mini map, address, date/time and weather along the bottom.
 */
export async function stampPhoto(
  frame: HTMLCanvasElement,
  pos: Coords,
  info: StampInfo,
): Promise<string> {
  const W = 960;
  const H = Math.round((frame.height / frame.width) * W);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(frame, 0, 0, W, H);

  const band = Math.round(H * 0.3);
  const top = H - band;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, top, W, band);

  const pad = 14;
  const mapSize = band - pad * 2;
  await drawMiniMap(ctx, pos, pad, top + pad, mapSize);

  // Weather column (right)
  const weatherW = 150;
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = "600 24px system-ui, sans-serif";
  ctx.fillText(info.weather, W - weatherW / 2 - pad, top + band * 0.45);
  ctx.font = "500 22px system-ui, sans-serif";
  if (info.temperatureC != null) {
    const f = info.temperatureC * 9 / 5 + 32;
    ctx.fillText(`${info.temperatureC.toFixed(1)} °C`, W - weatherW / 2 - pad, top + band * 0.65);
    ctx.fillText(`${f.toFixed(1)} °F`, W - weatherW / 2 - pad, top + band * 0.82);
  }

  // Address + date (centre)
  const textX = pad * 2 + mapSize;
  const textW = W - textX - weatherW - pad * 2;
  const cx = textX + textW / 2;
  ctx.font = "500 24px system-ui, sans-serif";
  const lines = wrapText(ctx, info.address, textW);
  let ty = top + pad + 28;
  for (const l of lines) {
    ctx.fillText(l, cx, ty);
    ty += 30;
  }
  const d = info.takenAt;
  const dateStr =
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  ctx.fillStyle = "#38bdf8";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText(dateStr, cx, H - pad - 6);
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "400 16px system-ui, sans-serif";
  ctx.fillText(`Lat ${pos.lat.toFixed(5)}  Lng ${pos.lng.toFixed(5)}`, cx, H - pad - 40);

  try {
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    // Canvas tainted (map tiles blocked CORS) — redraw without the map.
    const c2 = document.createElement("canvas");
    c2.width = W;
    c2.height = H;
    const ctx2 = c2.getContext("2d")!;
    ctx2.drawImage(frame, 0, 0, W, H);
    ctx2.fillStyle = "rgba(0,0,0,0.55)";
    ctx2.fillRect(0, top, W, band);
    ctx2.fillStyle = "#fff";
    ctx2.textAlign = "center";
    ctx2.font = "500 24px system-ui, sans-serif";
    let y2 = top + 40;
    for (const l of lines) { ctx2.fillText(l, W / 2, y2); y2 += 30; }
    ctx2.fillText(dateStr, W / 2, H - pad - 6);
    return c2.toDataURL("image/jpeg", 0.7);
  }
}
