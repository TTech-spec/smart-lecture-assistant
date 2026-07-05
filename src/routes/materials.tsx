import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft, BookOpen, FileText, Video, Globe,
  File, Lock, ExternalLink, Search, GraduationCap, CheckCircle2,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { loadMaterials, syncMaterialsFromSupabase, type Material, type MaterialFileType } from "@/lib/materials-store";
import { loadSettings } from "@/lib/attendance-store";
import { PaymentModal } from "@/components/PaymentModal";
import { hasUserPaidForMaterial } from "@/lib/opay";

export const Route = createFileRoute("/materials")({
  head: () => ({
    meta: [
      { title: "Study Materials — Attendly" },
      { name: "description", content: "Access study materials and resources shared by your lecturer." },
    ],
  }),
  component: MaterialsPage,
});

const FILE_TYPE_CONFIG: Record<MaterialFileType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  pdf:   { label: "PDF",   icon: FileText, color: "text-red-600",   bg: "bg-red-50 border-red-200" },
  video: { label: "Video", icon: Video,    color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
  doc:   { label: "Doc",   icon: FileText, color: "text-blue-600",  bg: "bg-blue-50 border-blue-200" },
  ppt:   { label: "Slides", icon: File,   color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
  link:  { label: "Link",  icon: Globe,    color: "text-green-600",  bg: "bg-green-50 border-green-200" },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.35, ease: "easeOut" as const },
  }),
};

function useMaterials() {
  const [materials, setMaterials] = useState<Material[]>(() => loadMaterials());
  useEffect(() => {
    syncMaterialsFromSupabase();
    const sync = () => setMaterials(loadMaterials());
    window.addEventListener("att:materials", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("att:materials", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return materials;
}

function MaterialsPage() {
  const materials = useMaterials();
  const settings = loadSettings();
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    materialId: string;
    materialTitle: string;
    amount: number;
    currency: string;
  }>({ open: false, materialId: "", materialTitle: "", amount: 0, currency: "NGN" });

  const courses = Array.from(new Set(materials.map((m) => m.courseCode).filter(Boolean)));

  const filtered = materials.filter((m) => {
    const matchCourse = courseFilter === "all" || m.courseCode === courseFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.courseCode.toLowerCase().includes(q) || m.topic.toLowerCase().includes(q);
    return matchCourse && matchSearch;
  });

  const handlePaymentSuccess = () => {
    // Refresh materials to update access status
    syncMaterialsFromSupabase();
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Header */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6 sm:py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          <span>Study Materials</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Study Materials</h1>
              <p className="text-sm text-muted-foreground">Resources shared by your lecturer to prepare ahead of tests &amp; exams.</p>
            </div>
          </div>
        </motion.div>

        {/* Filters */}
        {materials.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="mt-6 flex flex-wrap gap-3"
          >
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search materials…"
                className="pl-9"
              />
            </div>
            {courses.length > 1 && (
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All courses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All courses</SelectItem>
                  {courses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </motion.div>
        )}

        {/* Empty state */}
        {materials.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.35 }}
            className="mt-12 flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center shadow-soft"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <BookOpen className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">No materials yet</h2>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Your lecturer hasn't uploaded any study materials yet. Check back closer to your exam or test.
            </p>
          </motion.div>
        )}

        {/* No results after filter */}
        {materials.length > 0 && filtered.length === 0 && (
          <div className="mt-12 text-center text-sm text-muted-foreground">
            No materials match your search. <button className="underline" onClick={() => { setSearch(""); setCourseFilter("all"); }}>Clear filters</button>
          </div>
        )}

        {/* Grid */}
        {filtered.length > 0 && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((material, i) => (
              <MaterialCard 
                key={material.id} 
                material={material} 
                index={i} 
                onPaymentClick={(m) => setPaymentModal({
                  open: true,
                  materialId: m.id,
                  materialTitle: m.title,
                  amount: m.price,
                  currency: m.currency,
                })}
              />
            ))}
          </div>
        )}

        {/* Count */}
        {filtered.length > 0 && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Showing {filtered.length} of {materials.length} material{materials.length !== 1 ? "s" : ""}
            {settings.courseCode ? ` · Course: ${settings.courseCode}` : ""}
          </p>
        )}

        {/* Payment Modal */}
        <PaymentModal
          open={paymentModal.open}
          onClose={() => setPaymentModal({ ...paymentModal, open: false })}
          materialId={paymentModal.materialId}
          materialTitle={paymentModal.materialTitle}
          amount={paymentModal.amount}
          currency={paymentModal.currency}
          onSuccess={handlePaymentSuccess}
        />
      </main>
    </div>
  );
}

function MaterialCard({ material, index, onPaymentClick }: { material: Material; index: number; onPaymentClick: (m: Material) => void }) {
  const ft = FILE_TYPE_CONFIG[material.fileType] || FILE_TYPE_CONFIG.link;
  const Icon = ft.icon;
  const isPaid = material.accessType === "paid";
  
  // Check if user has paid (simplified - in real app, you'd get user email from auth)
  const [userEmail] = useState(() => {
    // Try to get email from localStorage or attendance records
    const records = JSON.parse(localStorage.getItem("att.records.v1") || "[]");
    return records.length > 0 ? records[0].matricNumber : "";
  });
  const hasPaid = isPaid && hasUserPaidForMaterial(material.id, userEmail);

  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className="group flex flex-col rounded-2xl border bg-card shadow-soft transition-shadow hover:shadow-md"
    >
      {/* Top accent strip */}
      <div className={`h-1 w-full rounded-t-2xl ${isPaid ? "bg-gradient-to-r from-amber-400 to-orange-500" : "bg-gradient-to-r from-primary to-primary/60"}`} />

      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        {/* File type + access badges */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${ft.bg} ${ft.color}`}>
            <Icon className="h-3 w-3" />
            {ft.label}
          </span>
          {isPaid ? (
            hasPaid ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                <CheckCircle2 className="h-3 w-3" />
                Purchased
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                <Lock className="h-3 w-3" />
                Paid · {material.currency} {material.price.toLocaleString()}
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
              Free
            </span>
          )}
        </div>

        {/* Title & description */}
        <div className="flex-1">
          <h3 className="font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
            {material.title}
          </h3>
          {material.description && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{material.description}</p>
          )}
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-1.5">
          {material.courseCode && (
            <Badge variant="secondary" className="text-xs">{material.courseCode}</Badge>
          )}
          {material.topic && (
            <Badge variant="outline" className="text-xs">{material.topic}</Badge>
          )}
        </div>

        {/* CTA */}
        {isPaid && !hasPaid ? (
          <Button
            className="w-full mt-auto"
            variant="default"
            size="sm"
            onClick={() => onPaymentClick(material)}
          >
            <Lock className="mr-1.5 h-3.5 w-3.5" />
            Pay {material.currency} {material.price.toLocaleString()}
          </Button>
        ) : (
          <Button
            className="w-full mt-auto"
            variant={isPaid ? "outline" : "default"}
            size="sm"
            onClick={() => {
              // Only allow access if material is free OR user has paid
              if (!isPaid || hasPaid) {
                if (material.fileType === "pdf") {
                  // Open PDF in new tab for inline viewing
                  window.open(material.url, "_blank");
                } else {
                  // For other file types, open in new tab
                  window.open(material.url, "_blank");
                }
              }
            }}
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {hasPaid ? "Access Material" : "Open Material"}
          </Button>
        )}

        {/* Date */}
        <p className="text-center text-[10px] text-muted-foreground/70">
          Added {new Date(material.uploadedAt).toLocaleDateString()}
        </p>
      </div>
    </motion.div>
  );
}
