import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Ban, Loader2, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStore } from "@/hooks/use-store";
import { disableLink, fetchRoomCode, isLinkValid, type AttendanceLink } from "@/lib/attendance-store";

export const Route = createFileRoute("/admin/projector")({
  head: () => ({ meta: [{ title: "Projector — Attendly" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ link: typeof s.link === "string" ? s.link : "" }),
  component: ProjectorPage,
});

function buildAttendUrl(token: string) {
  if (typeof window === "undefined") return `/attend/${token}`;
  return `${window.location.origin}/attend/${token}`;
}

/**
 * Full-screen page the lecturer puts on the projector: QR code to open the
 * check-in link, the room code that changes every 30 s, and a live count.
 * The code comes from the server (get_room_code) and is never sent to students.
 */
function ProjectorPage() {
  const { link: linkId } = Route.useSearch();
  const { links, records } = useStore();
  const link = useMemo(() => links.find((l) => l.id === linkId) ?? null, [links, linkId]);

  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Ask the server for the current code; re-ask whenever the slot rolls over.
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const r = await fetchRoomCode(link!.id);
        if (cancelled) return;
        if (!r) { setError("No code for this link. Run security-hardening.sql, then create the link again."); return; }
        setCode(r.code);
        setSecondsLeft(r.secondsLeft);
        setError(null);
        timer = setTimeout(load, Math.max(1, r.secondsLeft) * 1000 + 300);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not load the room code.";
        setError(/not_authorised/.test(msg) ? "Sign in as a lecturer to show the code."
          : /does not exist|schema cache/.test(msg) ? "Run security-hardening.sql in Supabase first." : msg);
        timer = setTimeout(load, 5000);
      }
    }
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [link]);

  // Local countdown between server refreshes
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  if (!link) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-muted-foreground">Pick a link on the Links page and tap “Projector”.</p>
        <Button asChild variant="outline" className="mt-6"><Link to="/admin/links">Go to links</Link></Button>
      </div>
    );
  }

  const open = isLinkValid(link, new Date(now));
  const count = records.filter((r) => r.linkId === link.id).length;
  const msLeft = new Date(link.expiresAt).getTime() - now;
  const closesIn = msLeft > 0 ? `${Math.floor(msLeft / 60000)}:${String(Math.floor((msLeft % 60000) / 1000)).padStart(2, "0")}` : "closed";
  const url = buildAttendUrl(link.token);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=0&data=${encodeURIComponent(url)}`;

  function endCheckIn(l: AttendanceLink) {
    if (!confirm("End check-in now? Students will no longer be able to submit.")) return;
    disableLink(l.id);
    toast.success("Check-in ended.");
  }

  function fullscreen() {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#121a2b] text-[#f1f5f4]" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex items-center justify-between px-8 py-6 sm:px-16">
        <p className="flex items-center gap-3 text-sm text-[#9aa6b8] sm:text-base">
          <span className={`inline-block h-2 w-2 rounded-full ${open ? "bg-[#4fd8a8]" : "bg-red-400"}`} />
          {link.courseCode} · {link.title}
        </p>
        <div className="flex items-center gap-5 text-sm font-medium sm:text-base">
          <button onClick={fullscreen} className="hidden items-center gap-2 text-[#9aa6b8] hover:text-white sm:flex" title="Full screen">
            <Maximize2 className="h-4 w-4" /> Full screen
          </button>
          {open && (
            <button onClick={() => endCheckIn(link)} className="flex items-center gap-2 text-red-300 hover:text-red-200">
              <Ban className="h-4 w-4" /> End check-in
            </button>
          )}
          <Link to="/admin/links" className="flex items-center gap-2 text-[#9aa6b8] hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Exit
          </Link>
        </div>
      </div>

      <div className="flex flex-grow flex-col items-center justify-center gap-10 px-8 lg:flex-row lg:gap-28">
        <div className="rounded-3xl bg-white p-4 sm:p-5">
          <img src={qrSrc} alt={`QR code for ${link.title}`} className="h-48 w-48 sm:h-64 sm:w-64" />
        </div>
        <div className="flex flex-col items-center gap-4 lg:items-start">
          <p className="text-base text-[#9aa6b8] sm:text-lg">Scan, then enter this code</p>
          {error ? (
            <p className="max-w-md text-center text-lg text-amber-300 lg:text-left">{error}</p>
          ) : code ? (
            <p className="font-mono text-[96px] font-semibold leading-none tracking-[0.08em] text-white sm:text-[150px] lg:text-[180px]">{code}</p>
          ) : (
            <Loader2 className="h-16 w-16 animate-spin text-[#9aa6b8]" />
          )}
          <div className="h-[3px] w-full max-w-md rounded bg-[#283349]">
            <div className="h-full rounded bg-[#4fd8a8] transition-[width] duration-1000 ease-linear" style={{ width: `${(secondsLeft / 30) * 100}%` }} />
          </div>
          <p className="text-sm text-[#9aa6b8] sm:text-base">New code in {secondsLeft}s</p>
        </div>
      </div>

      <div className="flex items-baseline justify-between px-8 py-6 text-sm text-[#9aa6b8] sm:px-16 sm:text-base">
        <p><span className="text-3xl font-semibold text-white sm:text-4xl">{count}</span> <span className="ml-2">checked in</span></p>
        <p>{open ? `Closes in ${closesIn}` : "Check-in closed"}</p>
      </div>
    </div>
  );
}
