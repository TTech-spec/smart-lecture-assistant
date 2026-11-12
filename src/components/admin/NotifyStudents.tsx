import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { sendNotice } from "@/lib/push-server";

/** Lecturer: send a notice to every student who turned on notifications. */
export function NotifyStudents({ defaultTitle, defaultBody, defaultUrl = "/attendance", label = "Notify students" }: {
  defaultTitle: string; defaultBody?: string; defaultUrl?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState(defaultBody ?? "");
  const [sending, setSending] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return toast.error("Write a short title.");
    setSending(true);
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) { setSending(false); return toast.error("Sign in again to send notices."); }
    const r = await sendNotice({ data: { accessToken: token, title: title.trim(), body: body.trim(), url: defaultUrl, origin: window.location.origin } }).catch(() => null);
    setSending(false);
    if (!r) return toast.error("We couldn't reach the server. Check your connection and try again.");
    if (!r.ok) return toast.error(r.message);
    toast.success(r.sent ? `Sent to ${r.sent} phone${r.sent > 1 ? "s" : ""}.` : "Saved. No students have turned on notifications yet.");
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" className="h-10 rounded-xl" onClick={() => { setTitle(defaultTitle); setBody(defaultBody ?? ""); setOpen(true); }}>
        <Bell className="mr-1.5 h-4 w-4" /> {label}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
            <motion.form onSubmit={send} initial={{ y: 30 }} animate={{ y: 0 }} exit={{ y: 30 }}
              className="flex w-full max-w-md flex-col gap-4 rounded-t-3xl bg-background p-5 sm:rounded-3xl" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold">Notify students</h2>
                  <p className="text-[13px] text-muted-foreground">Goes to every student who turned on notifications. Tapping it opens Sign attendance.</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-2 text-muted-foreground hover:bg-secondary"><X className="h-5 w-5" /></button>
              </div>
              <div>
                <Label htmlFor="notice-title">Title</Label>
                <Input id="notice-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-11 rounded-xl text-base" />
              </div>
              <div>
                <Label htmlFor="notice-body">Message (optional)</Label>
                <Input id="notice-body" value={body} maxLength={200} onChange={(e) => setBody(e.target.value)} className="mt-1 h-11 rounded-xl text-base" />
              </div>
              <div className="rounded-2xl bg-secondary/60 p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Preview</p>
                <p className="mt-1 text-sm font-semibold">{title || "Title"}</p>
                {body && <p className="text-[13px] text-muted-foreground">{body}</p>}
              </div>
              <Button type="submit" disabled={sending} className="h-12 rounded-full text-base">
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />} Send notice
              </Button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
