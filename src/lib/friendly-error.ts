/**
 * Turns technical errors (database, network, payment provider) into short,
 * friendly sentences that say what happened and what to do next.
 * Messages that are already written for people pass through unchanged.
 */
const RULES: { test: RegExp; message: string }[] = [
  { test: /failed to fetch|networkerror|network request failed|load failed|err_internet|timed? ?out|ECONNRESET/i,
    message: "We couldn't reach the server. Check your internet connection and try again." },
  { test: /invalid login credentials/i,
    message: "That email or password isn't right. Check them and try again." },
  { test: /jwt expired|invalid jwt|not_signed_in|session (has )?expired|refresh token/i,
    message: "Your sign-in has expired. Please sign in again." },
  { test: /not_lecturer|not_authorised|not authorized/i,
    message: "This account isn't set up as a lecturer yet. Ask the admin to add you." },
  { test: /row-level security|permission denied|42501|insufficient_privilege/i,
    message: "You don't have permission to do that. If you're a lecturer, sign out and sign in again." },
  { test: /api key is empty or invalid|secret key not configured|SQUAD_SECRET_KEY|SERVICE_ROLE|payments aren't set up/i,
    message: "Payments aren't switched on yet. Please let your lecturer know and try again later." },
  { test: /squad api error|squad api returned|bad gateway|502|503|504|service unavailable/i,
    message: "The payment service is busy right now. Please wait a minute and try again." },
  { test: /payload too large|413|exceeded the maximum allowed size|file size/i,
    message: "That file is too big. Try a smaller file." },
  { test: /duplicate key|already exists|23505/i,
    message: "That's already saved, so nothing new was added." },
  { test: /does not exist|schema cache|could not find the (function|table)|PGRST20\d/i,
    message: "This feature isn't switched on yet. Please let your lecturer know." },
  { test: /bucket not found/i,
    message: "File storage isn't set up yet. Please let your lecturer know." },
  { test: /geolocation|user denied|permission denied geolocation/i,
    message: "We need your location for this. Allow location for this site and try again." },
];

const LOOKS_TECHNICAL = /violates|constraint|syntax error|PGRST|SQLSTATE|ERROR:|exception|undefined|null value|\{|\}|^[a-z]+_[a-z_]+(:\d+)*$|stack|TypeError|ReferenceError/;

export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!raw.trim()) return fallback;
  for (const r of RULES) if (r.test.test(raw)) return r.message;
  if (LOOKS_TECHNICAL.test(raw) || raw.length > 220) return fallback;
  return raw;
}

/** Extra situations students run into, in plain words */
const STUDENT_RULES: { test: RegExp; message: string }[] = [
  { test: /rate limit|too many|try again later|429/i,
    message: "Too many tries in a short time. Wait a minute, then try again." },
  { test: /not_configured|isn't switched on|not set up|does not exist|schema cache/i,
    message: "This isn't switched on yet. Please let your lecturer know." },
  { test: /camera|notallowederror|notreadableerror|notfounderror|getusermedia|videoinput/i,
    message: "We couldn't use your camera. Allow camera access for this site, close other apps using the camera, and try again." },
  { test: /quota|storage full|exceeded the quota/i,
    message: "Your phone's browser storage is full. Clear some browsing data and try again." },
];

/**
 * For student pages: always a short, friendly sentence. Never shows the
 * server's own error text, whatever it says; unknown errors get `fallback`.
 */
export function studentError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = err instanceof Error ? `${err.name} ${err.message}` : typeof err === "string" ? err : "";
  if (!raw.trim()) return fallback;
  // Student wording first (camera, limits…), then the shared network rule; anything else gets the fallback
  for (const r of STUDENT_RULES) if (r.test.test(raw)) return r.message;
  if (RULES[0].test.test(raw)) return RULES[0].message; // can't reach the server
  if (/duplicate key|already exists|23505/i.test(raw)) return "This was already saved. You don't need to do it again.";
  return fallback;
}
