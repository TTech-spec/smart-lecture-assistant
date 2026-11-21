import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Flag, FlaskConical, Home, MonitorPlay, MoreHorizontal, Plus, Radio } from "lucide-react";
import { isLinkValid, type AttendanceLink, type AttendanceRecord } from "@/lib/attendance-store";
import { needsReview } from "@/components/admin/AdminSidebar";

type Tab = { key: string; to: string; label: string; icon: typeof Home; exact?: boolean };
const LEFT: Tab[] = [
  { key: "home", to: "/admin", label: "Home", icon: Home, exact: true },
  { key: "live", to: "/admin/live", label: "Live", icon: Radio },
];
const RIGHT: Tab[] = [{ key: "review", to: "/admin/review", label: "Review", icon: Flag }];

/**
 * Phone-only navigation: Home · Live · (+) · Review · More.
 * The green + starts a check-in from any page; More opens the full menu.
 */
export function MobileTabBar({ links, records, onMore }: { links: AttendanceLink[]; records: AttendanceRecord[]; onMore: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname.replace(/\/$/, "") || "/" });
  const navigate = useNavigate();
  const [plusOpen, setPlusOpen] = useState(false);
  const live = useMemo(
    () => links.filter((l) => (l.linkType ?? "attendance") === "attendance" && isLinkValid(l)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    [links],
  );
  const reviewCount = useMemo(() => records.filter(needsReview).length, [records]);
  const active = (t: Tab) => (t.exact ? path === t.to : path === t.to || path.startsWith(`${t.to}/`));
  const onLive = path.startsWith("/admin/live");
  const known = [...LEFT, ...RIGHT].some(active);

  const go = (to: string, search?: Record<string, string>) => { setPlusOpen(false); navigate({ to, search: search as never }); };

  const tabButton = (t: Tab) => (
    <Link key={t.key} to={t.to} aria-current={active(t) ? "page" : undefined} onClick={() => setPlusOpen(false)}
      className={`flex min-h-[48px] min-w-[54px] flex-col items-center justify-center gap-[3px] ${onLive ? "text-[#7f8ea3] aria-[current=page]:text-white" : "text-muted-foreground aria-[current=page]:text-foreground"}`}>
      <span className="relative grid h-7 w-[52px] place-items-center">
        <t.icon className="relative h-[21px] w-[21px]" strokeWidth={active(t) ? 2.3 : 1.8} />
        {active(t) && <motion.span layoutId="m-tab-pill" className="absolute -bottom-[19px] h-[3px] w-5 rounded-full bg-current" transition={{ type: "spring", stiffness: 500, damping: 34 }} />}
        {t.key === "live" && live && <span className="absolute right-3 top-0.5 h-[7px] w-[7px] rounded-full bg-[#12b886]" />}
        {t.key === "review" && reviewCount > 0 && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-1 right-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
            {reviewCount > 99 ? "99+" : reviewCount}
          </motion.span>
        )}
      </span>
      <span className="text-[10.5px] font-medium">{t.label}</span>
    </Link>
  );

  return (
    <>
      <nav aria-label="Main"
        className={`fixed inset-x-0 bottom-0 z-[45] flex items-center justify-around border-t px-2 pt-2 backdrop-blur-md lg:hidden ${onLive ? "border-white/10 bg-[#0c1322]/95" : "border-[rgba(27,36,57,0.08)] bg-background/95"}`}
        style={{ paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }}>
        {LEFT.map(tabButton)}
        <motion.button type="button" onClick={() => setPlusOpen((o) => !o)} aria-label={plusOpen ? "Close" : "Start a check-in"} aria-expanded={plusOpen}
          whileTap={{ scale: 0.88 }} animate={{ rotate: plusOpen ? 135 : 0 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}
          className={`grid h-12 w-12 place-items-center rounded-full ${onLive ? "bg-white text-[#0c1322]" : "bg-foreground text-background"}`}>
          <Plus className="h-6 w-6" strokeWidth={2.2} />
        </motion.button>
        {RIGHT.map(tabButton)}
        <button type="button" onClick={() => { setPlusOpen(false); onMore(); }}
          className={`flex min-h-[48px] min-w-[54px] flex-col items-center justify-center gap-[3px] ${known ? (onLive ? "text-[#7f8ea3]" : "text-muted-foreground") : (onLive ? "text-white" : "text-foreground")}`}>
          <span className="relative grid h-7 w-[52px] place-items-center">
            <MoreHorizontal className="relative h-[21px] w-[21px]" />
            {!known && <motion.span layoutId="m-tab-pill" className="absolute -bottom-[19px] h-[3px] w-5 rounded-full bg-current" />}
          </span>
          <span className="text-[10.5px] font-medium">More</span>
        </button>
      </nav>

      <AnimatePresence>
        {plusOpen && (
          <>
            <motion.button type="button" aria-label="Close" className="fixed inset-0 z-[43] bg-[rgba(8,12,20,0.45)] lg:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPlusOpen(false)} />
            <motion.section role="dialog" aria-label="Start" className="fixed inset-x-0 bottom-0 z-[44] rounded-t-[28px] bg-white px-4 pt-2 text-[#13202f] lg:hidden dark:bg-[#151e2c] dark:text-white"
              style={{ paddingBottom: "calc(92px + env(safe-area-inset-bottom, 0px))", touchAction: "none" }}
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 34 }}
              drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} onDragEnd={(_, i) => { if (i.offset.y > 90) setPlusOpen(false); }}>
              <div className="mx-auto mb-3 mt-1 h-[5px] w-11 rounded-full bg-[#d3dbe3]" aria-hidden="true" />
              <h2 className="mb-3 px-1 text-xl font-bold">{live ? "Check-in is running" : "Start something"}</h2>
              <motion.div className="flex flex-col gap-2.5" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } }}>
                {live && <SheetRow icon={<Radio className="h-5 w-5" />} title={`Open live: ${live.courseCode}`} sub="Ring, map and who has arrived" tone="green" onClick={() => go("/admin/live")} />}
                {live && <SheetRow icon={<MonitorPlay className="h-5 w-5" />} title="Show the projector screen" sub="QR code and class code" onClick={() => go("/admin/projector", { link: live.id })} />}
                <SheetRow icon={<Plus className="h-5 w-5" />} title={live ? "Start another check-in" : "Start a check-in"} sub="Verify your location, then share the link" tone={live ? undefined : "green"} onClick={() => go("/admin/links", { new: "attendance" })} />
                <SheetRow icon={<FlaskConical className="h-5 w-5" />} title="Open a test" sub="Share a test link with the class" onClick={() => go("/admin/links", { new: "test" })} />
              </motion.div>
            </motion.section>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function SheetRow({ icon, title, sub, onClick, tone }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; tone?: "green" }) {
  return (
    <motion.button type="button" onClick={onClick} whileTap={{ scale: 0.98 }} variants={{ h: { opacity: 0, y: 12 }, s: { opacity: 1, y: 0 } }}
      className={`flex min-h-[64px] items-center gap-3 rounded-2xl border px-4 text-left ${tone === "green" ? "border-transparent bg-foreground text-background" : "border-[rgba(27,36,57,0.1)] dark:border-white/10"}`}>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone === "green" ? "bg-white/15" : "bg-secondary"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{title}</span>
        <span className={`block truncate text-[12.5px] ${tone === "green" ? "opacity-70" : "text-muted-foreground"}`}>{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 opacity-60" />
    </motion.button>
  );
}
