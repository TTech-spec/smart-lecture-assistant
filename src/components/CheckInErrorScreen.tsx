import { Link } from "@tanstack/react-router";
import { Clock, KeyRound, LocateOff, MapPinOff, RefreshCw, ShieldAlert, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CheckInError } from "@/lib/attendance-store";
import { formatDistance } from "@/lib/geo";

type Props = {
  error: CheckInError;
  courseCode: string;
  onRetry: () => void;
};

/** Full-screen explanation when the server refuses a check-in, with what to do next. */
export function CheckInErrorScreen({ error, courseCode, onRetry }: Props) {
  const v = describe(error, courseCode);
  const tone = v.tone;
  const ring = tone === "red" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
    : tone === "amber" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
    : "bg-secondary text-muted-foreground";

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${ring}`}>{v.icon}</div>
          <h1 className="text-2xl font-semibold leading-tight">{v.title}</h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{v.body}</p>

        {v.facts && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            {v.facts.map((f) => (
              <div key={f.label} className="rounded-xl bg-secondary/60 px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground">{f.label}</p>
                <p className={`mt-0.5 text-lg font-semibold ${f.tone === "red" ? "text-red-700 dark:text-red-300" : f.tone === "green" ? "text-primary" : ""}`}>{f.value}</p>
              </div>
            ))}
          </div>
        )}

        {v.steps && (
          <div className="mt-5 rounded-xl bg-secondary/60 p-4 text-sm leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">{v.stepsTitle}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              {v.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>
        )}

        {v.note && <p className="mt-4 text-xs text-amber-700 dark:text-amber-400">{v.note}</p>}

        <div className="flex-grow" />

        {v.retry && (
          <Button className="h-12 w-full text-base" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" /> {v.retry}
          </Button>
        )}
        <Button asChild variant="ghost" className="mt-2 w-full">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}

type Fact = { label: string; value: string; tone?: "red" | "green" };
type View = {
  tone: "red" | "amber" | "grey";
  icon: React.ReactNode;
  title: string;
  body: string;
  facts?: Fact[];
  stepsTitle?: string;
  steps?: string[];
  note?: string;
  retry?: string;
};

function describe(e: CheckInError, course: string): View {
  switch (e.code) {
    case "out_of_range":
      return {
        tone: "red",
        icon: <MapPinOff className="h-6 w-6" />,
        title: "You're not in the class area",
        body: "Your attendance was not saved. You must be inside the lecture venue, near your lecturer, to check in.",
        facts: [
          { label: "Your distance", value: e.meters != null ? formatDistance(e.meters) : "—", tone: "red" },
          { label: "Allowed", value: `within ${e.radius ?? 100} m`, tone: "green" },
        ],
        stepsTitle: "In class already? Try this:",
        steps: [
          "Turn on Location and set it to high accuracy (Android: Google Location Accuracy; iPhone: Precise Location).",
          "Turn on WiFi, even without connecting — it helps indoors.",
          "Move near a window or the door and wait 10 seconds.",
        ],
        note: "This attempt has been logged for your lecturer.",
        retry: "Try again",
      };
    case "weak_gps":
      return {
        tone: "amber",
        icon: <LocateOff className="h-6 w-6" />,
        title: "Your location signal is too weak",
        body: `Your phone could only place you to within about ${e.meters ?? "?"} m. We need better than 150 m to confirm you're in the venue.`,
        stepsTitle: "To get a better signal:",
        steps: [
          "Android: Settings → Location → Google Location Accuracy → On.",
          "iPhone: Settings → Privacy → Location Services → Safari → Precise Location → On.",
          "Turn on WiFi and move near a window or the door.",
          "Wait for the accuracy on the camera screen to drop below ±50 m, then capture.",
        ],
        retry: "Try again",
      };
    case "no_gps":
      return {
        tone: "amber",
        icon: <LocateOff className="h-6 w-6" />,
        title: "Turn on location to check in",
        body: "Check-in needs your location and camera. They're used only for this check-in.",
        stepsTitle: "How to allow it:",
        steps: [
          "Android (Chrome): tap the lock icon next to the address → Permissions → Location → Allow.",
          "iPhone (Safari): Settings → Safari → Location → Allow, and Precise Location → On.",
          "Make sure the phone's Location switch is on.",
        ],
        retry: "I've turned it on — try again",
      };
    case "wrong_code":
      return {
        tone: "amber",
        icon: <KeyRound className="h-6 w-6" />,
        title: "That room code isn't right",
        body: "The code changes every 30 seconds. Look at the projector and enter the one showing now.",
        stepsTitle: "Tip",
        steps: ["Letters are never O or I, so 0 and 1 are always numbers."],
        note: "After 5 wrong attempts, this phone is locked for 5 minutes and your lecturer is notified.",
        retry: "Enter the current code",
      };
    case "closed":
      return {
        tone: "grey",
        icon: <Clock className="h-6 w-6" />,
        title: "Check-in has closed",
        body: `Attendance for ${course} is no longer open. Late check-ins can't be accepted. Stay for the lecture — your lecturer may open a surprise check later.`,
      };
    case "locked":
      return {
        tone: "red",
        icon: <ShieldAlert className="h-6 w-6" />,
        title: "Too many attempts",
        body: "This phone made several failed check-ins in a short time, so it is paused for 5 minutes. Your lecturer has been notified.",
        retry: "Try again in 5 minutes",
      };
    case "duplicate_device":
      return {
        tone: "amber",
        icon: <UserX className="h-6 w-6" />,
        title: "This phone already checked in",
        body: `This phone has already been used to mark attendance for ${course} today. Only one student per phone per course per day.`,
        note: "If this is a mistake, speak to your lecturer.",
      };
    case "blocked":
      return {
        tone: "red",
        icon: <UserX className="h-6 w-6" />,
        title: "You can't sign this class",
        body: `Your lecturer has blocked your matric number for this ${course} session.`,
        note: "If you think this is a mistake, speak to your lecturer after class.",
      };
    case "duplicate_matric":
      return {
        tone: "amber",
        icon: <UserX className="h-6 w-6" />,
        title: "Already marked today",
        body: `This matric number has already been marked present for ${course} today.`,
      };
    case "no_location":
      return {
        tone: "grey",
        icon: <MapPinOff className="h-6 w-6" />,
        title: "Check-in isn't ready yet",
        body: "Your lecturer hasn't verified the class location for this check-in, so it can't accept anyone yet. Let your lecturer know — they need to start a new check-in from the lecture hall.",
      };
    case "not_found":
      return {
        tone: "grey",
        icon: <Clock className="h-6 w-6" />,
        title: "Link not found",
        body: "This attendance link doesn't exist. Ask your lecturer for the correct link.",
      };
    case "not_configured":
      return {
        tone: "grey",
        icon: <ShieldAlert className="h-6 w-6" />,
        title: "Check-in isn't set up yet",
        body: e.message,
      };
    default:
      return {
        tone: "red",
        icon: <ShieldAlert className="h-6 w-6" />,
        title: "Something went wrong",
        body: e.message || "Could not save your attendance. Please try again.",
        retry: "Try again",
      };
  }
}
