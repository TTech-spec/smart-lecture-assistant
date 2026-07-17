import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Upload, BookOpen, Globe, Lock, FileText, Video, File,
  Plus, Trash2, ExternalLink, Sparkles, CheckCircle2,
  X, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  loadMaterials, addMaterial, deleteMaterial, syncMaterialsFromSupabase,
  uploadMaterialFile, type Material, type MaterialFileType, type MaterialAccessType,
} from "@/lib/materials-store";
import { calcFees, NG_BANKS } from "@/lib/squad";

type MaterialsSearch = {
  accessType?: MaterialAccessType;
};

export const Route = createFileRoute("/admin/materials")({
  head: () => ({ meta: [{ title: "Materials — Attendly" }] }),
  validateSearch: (search: Record<string, unknown>): MaterialsSearch => ({
    accessType: search.accessType === "paid" ? "paid" : search.accessType === "free" ? "free" : undefined,
  }),
  component: MaterialsAdmin,
});

const FILE_TYPE_CONFIG: Record<MaterialFileType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  pdf:   { label: "PDF",    icon: FileText, color: "text-red-600",    bg: "bg-red-50 border-red-200"      },
  video: { label: "Video",  icon: Video,    color: "text-purple-600",  bg: "bg-purple-50 border-purple-200" },
  doc:   { label: "Doc",    icon: FileText, color: "text-blue-600",   bg: "bg-blue-50 border-blue-200"    },
  ppt:   { label: "Slides", icon: File,     color: "text-orange-600",  bg: "bg-orange-50 border-orange-200" },
  link:  { label: "Link",   icon: Globe,    color: "text-green-600",   bg: "bg-green-50 border-green-200"  },
};

type Draft = {
  title: string;
  description: string;
  fileType: MaterialFileType;
  accessType: MaterialAccessType;
  price: string;
  currency: string;
  url: string;
  courseCode: string;
  topic: string;
  file: File | null;
  lecturerAccountNumber: string;
  lecturerBankCode: string;
  lecturerAccountName: string;
};

const emptyDraft: Draft = {
  title: "", description: "", fileType: "pdf", accessType: "free",
  price: "", currency: "NGN", url: "", courseCode: "", topic: "", file: null,
  lecturerAccountNumber: "", lecturerBankCode: "", lecturerAccountName: "",
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
  return { materials, refresh: () => setMaterials(loadMaterials()) };
}

function MaterialsAdmin() {
  const { accessType: intentAccessType } = Route.useSearch();
  const { materials, refresh } = useMaterials();
  // null = not yet answered, false = dismissed, true = open form
  const [promptAnswer, setPromptAnswer] = useState<null | boolean>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // If materials already exist, skip the prompt
  const hasExisting = materials.length > 0;

  // Arrived from the dashboard setup wizard with a free/paid intent — open the form pre-filled.
  useEffect(() => {
    if (!intentAccessType) return;
    setDraft({ ...emptyDraft, accessType: intentAccessType });
    setFormOpen(true);
    setPromptAnswer(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function upd<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  function openAddForm() {
    setDraft(emptyDraft);
    setFormOpen(true);
    setPromptAnswer(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return toast.error("Please enter a material title.");

    // Either file or URL must be provided
    if (!draft.file && !draft.url.trim()) {
      return toast.error("Please upload a file or enter a URL.");
    }

    if (draft.accessType === "paid") {
      if (!draft.price || isNaN(Number(draft.price)) || Number(draft.price) <= 0) {
        return toast.error("Please enter a valid price for paid materials.");
      }
      if (!draft.lecturerAccountNumber.trim()) {
        return toast.error("Please enter your bank account number so students' payments can be sent to you.");
      }
      if (!draft.lecturerBankCode) {
        return toast.error("Please select your bank.");
      }
      if (!draft.lecturerAccountName.trim()) {
        return toast.error("Please enter your account name.");
      }
    }

    setSaving(true);
    try {
      let finalUrl = draft.url.trim();

      // If file is uploaded, store it in Supabase Storage
      if (draft.file) {
        const tempId = crypto.randomUUID();
        finalUrl = await uploadMaterialFile(draft.file, tempId);
      }

      await addMaterial({
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        description: draft.description.trim(),
        fileType: draft.fileType,
        accessType: draft.accessType,
        price: draft.accessType === "paid" ? Number(draft.price) : 0,
        currency: draft.currency || "NGN",
        url: finalUrl,
        courseCode: draft.courseCode.trim().toUpperCase(),
        topic: draft.topic.trim(),
        uploadedAt: new Date().toISOString(),
        ...(draft.accessType === "paid" && {
          lecturerAccountNumber: draft.lecturerAccountNumber.trim(),
          lecturerBankCode: draft.lecturerBankCode,
          lecturerAccountName: draft.lecturerAccountName.trim(),
        }),
      });
      toast.success("Material uploaded and shared with students.");
      setDraft(emptyDraft);
      setFormOpen(false);
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save material";
      toast.error(`Could not save: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      deleteMaterial(id);
      refresh();
      toast.success("Material removed.");
    } finally {
      setDeletingId(null);
    }
  }

  const fees = useMemo(() => {
    const p = Number(draft.price);
    if (!draft.price || isNaN(p) || p <= 0) return null;
    return calcFees(p);
  }, [draft.price]);

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Study Materials</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Share resources for students to read ahead of exams or tests.
          </p>
        </div>
        {hasExisting && (
          <Button onClick={openAddForm} className="shrink-0">
            <Plus className="mr-1.5 h-4 w-4" /> Add Material
          </Button>
        )}
      </motion.div>

      {/* ── PROMPT CARD (shown when no materials yet and not dismissed) ── */}
      <AnimatePresence>
        {!hasExisting && promptAnswer !== false && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="relative mt-6 overflow-hidden rounded-2xl border-2 border-dashed border-primary/40 bg-gradient-to-br from-primary/5 via-card to-transparent p-6 shadow-soft sm:p-8"
          >
            {/* Decorative glow blob */}
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-primary/8 blur-2xl" />

            {/* Dismiss */}
            <button
              onClick={() => setPromptAnswer(false)}
              className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative">
              {/* Icon badge */}
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
                <Sparkles className="h-6 w-6" />
              </div>

              <h2 className="mt-4 text-lg font-bold sm:text-xl">
                Would you like to share study materials with your students?
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Upload PDFs, videos, slides, or links for students to prepare ahead of their exams or tests.
              </p>

              {/* Access type teaser */}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {/* Open / Free */}
                <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50/60 p-3.5">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-100">
                    <Globe className="h-4 w-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-green-800">Open Access (Free)</p>
                    <p className="mt-0.5 text-xs text-green-700">
                      Any student can view or download with a direct link. No payment required.
                    </p>
                  </div>
                </div>

                {/* Paid */}
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                    <Lock className="h-4 w-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Paid Access</p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      Set a price per material. Students see the cost before clicking through.
                    </p>
                  </div>
                </div>
              </div>

              {/* CTA row */}
              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={openAddForm} className="gap-2">
                  <Upload className="h-4 w-4" />
                  Yes, upload materials
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPromptAnswer(false)}
                >
                  Maybe later
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ADD MATERIAL FORM ── */}
      <AnimatePresence>
        {formOpen && (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            onSubmit={handleSave}
            className="mt-6 rounded-2xl border bg-card p-5 shadow-soft sm:p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Add New Material</h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {/* Title */}
              <div className="sm:col-span-2">
                <Label htmlFor="mat-title">Title <span className="text-destructive">*</span></Label>
                <Input
                  id="mat-title"
                  value={draft.title}
                  onChange={(e) => upd("title", e.target.value)}
                  placeholder="e.g. PSY101 Chapter 3 Notes"
                  className="mt-1.5"
                />
              </div>

              {/* Description */}
              <div className="sm:col-span-2">
                <Label htmlFor="mat-desc">Description</Label>
                <Textarea
                  id="mat-desc"
                  value={draft.description}
                  onChange={(e) => upd("description", e.target.value)}
                  placeholder="What does this material cover? Any instructions for students?"
                  rows={2}
                  className="mt-1.5 resize-none"
                />
              </div>

              {/* File Upload */}
              <div className="sm:col-span-2">
                <Label htmlFor="mat-file">Upload File (PDF, DOC, PPT)</Label>
                <Input
                  id="mat-file"
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx"
                  onChange={(e) => upd("file", e.target.files?.[0] || null)}
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">Upload a file directly. Stored in Supabase Storage. Recommended max: 50MB.</p>
              </div>

              {/* URL */}
              <div className="sm:col-span-2">
                <Label htmlFor="mat-url">Or paste URL / Link</Label>
                <Input
                  id="mat-url"
                  type="url"
                  value={draft.url}
                  onChange={(e) => upd("url", e.target.value)}
                  placeholder="https://drive.google.com/… or YouTube link"
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">Paste a Google Drive, YouTube, Dropbox, or any public link.</p>
              </div>

              {/* File type */}
              <div>
                <Label>File Type</Label>
                <Select value={draft.fileType} onValueChange={(v) => upd("fileType", v as MaterialFileType)}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF Document</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="doc">Word / Doc</SelectItem>
                    <SelectItem value="ppt">Slides / PPT</SelectItem>
                    <SelectItem value="link">Web Link</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Course code */}
              <div>
                <Label htmlFor="mat-course">Course Code</Label>
                <Input
                  id="mat-course"
                  value={draft.courseCode}
                  onChange={(e) => upd("courseCode", e.target.value)}
                  placeholder="e.g. PSY101"
                  className="mt-1.5"
                />
              </div>

              {/* Topic */}
              <div>
                <Label htmlFor="mat-topic">Topic / Tag</Label>
                <Input
                  id="mat-topic"
                  value={draft.topic}
                  onChange={(e) => upd("topic", e.target.value)}
                  placeholder="e.g. Cognition"
                  className="mt-1.5"
                />
              </div>

              {/* Access type */}
              <div>
                <Label>Access Type</Label>
                <Select value={draft.accessType} onValueChange={(v) => upd("accessType", v as MaterialAccessType)}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">
                      <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-green-600" /> Open Access (Free)</span>
                    </SelectItem>
                    <SelectItem value="paid">
                      <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-amber-600" /> Paid</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Price + bank details (conditional on paid) */}
              <AnimatePresence>
                {draft.accessType === "paid" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="sm:col-span-2 space-y-4"
                  >
                    {/* ── Price row ── */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="mat-price">Your Price (what you receive) <span className="text-destructive">*</span></Label>
                        <Input
                          id="mat-price"
                          type="number"
                          min={1}
                          step="1"
                          value={draft.price}
                          onChange={(e) => upd("price", e.target.value)}
                          placeholder="e.g. 2000"
                          className="mt-1.5"
                        />
                      </div>
                      <div>
                        <Label>Currency</Label>
                        <Select value={draft.currency} onValueChange={(v) => upd("currency", v)}>
                          <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NGN">NGN (₦)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* ── Live fee breakdown ── */}
                    <AnimatePresence>
                      {fees && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-900/20 p-4 space-y-2 text-sm"
                        >
                          <div className="flex items-center gap-2 font-semibold text-blue-800 dark:text-blue-300">
                            <Info className="h-4 w-4 shrink-0" />
                            What the student will be charged
                          </div>
                          <div className="space-y-1 text-blue-700 dark:text-blue-400 text-xs">
                            <div className="flex justify-between">
                              <span>Your price (you receive this)</span>
                              <span>₦{fees.lecturerPrice.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Processing fee (payment gateway)</span>
                              <span>₦{fees.platformFee.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Transfer fee (bank payout)</span>
                              <span>₦{fees.transferFee.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Squad payment gateway (1.2%, max ₦1,500)</span>
                              <span>₦{fees.squadFee.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between font-bold text-blue-900 dark:text-blue-200 border-t border-blue-200 dark:border-blue-700 pt-1.5 mt-1">
                              <span>Total student pays</span>
                              <span>₦{fees.totalCharge.toLocaleString()}</span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* ── Lecturer bank details ── */}
                    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20 p-4 space-y-3">
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                        <Lock className="h-4 w-4" /> Your payout bank details
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Payments go directly to your bank account after each purchase. A ₦1,000 processing fee covers payment gateway charges.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="mat-bank">Your Bank <span className="text-destructive">*</span></Label>
                          <Select value={draft.lecturerBankCode} onValueChange={(v) => upd("lecturerBankCode", v)}>
                            <SelectTrigger id="mat-bank" className="mt-1.5 bg-white dark:bg-background">
                              <SelectValue placeholder="Select bank" />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              {NG_BANKS.map((b) => (
                                <SelectItem key={b.code} value={b.code}>{b.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="mat-acct">Account Number <span className="text-destructive">*</span></Label>
                          <Input
                            id="mat-acct"
                            value={draft.lecturerAccountNumber}
                            onChange={(e) => upd("lecturerAccountNumber", e.target.value.replace(/\D/g, "").slice(0, 10))}
                            placeholder="0123456789"
                            maxLength={10}
                            className="mt-1.5 bg-white dark:bg-background font-mono tracking-wider"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Label htmlFor="mat-acct-name">Account Name <span className="text-destructive">*</span></Label>
                          <Input
                            id="mat-acct-name"
                            value={draft.lecturerAccountName}
                            onChange={(e) => upd("lecturerAccountName", e.target.value)}
                            placeholder="e.g. Dr. Adeola Okonkwo"
                            className="mt-1.5 bg-white dark:bg-background"
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mt-5 flex gap-2">
              <Button type="submit" disabled={saving} className="gap-2">
                {saving
                  ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> Saving…</>
                  : <><CheckCircle2 className="h-4 w-4" /> Save Material</>
                }
              </Button>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* ── EXISTING MATERIALS LIST ── */}
      {materials.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.35 }}
          className="mt-6"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {materials.length} Material{materials.length !== 1 ? "s" : ""} Published
            </h2>
            <span className="flex items-center gap-1 text-xs text-green-600">
              <BookOpen className="h-3.5 w-3.5" /> Visible to students
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {materials.map((mat) => {
                const ft = FILE_TYPE_CONFIG[mat.fileType] || FILE_TYPE_CONFIG.link;
                const Icon = ft.icon;
                const isPaid = mat.accessType === "paid";
                const isExpanded = expandedId === mat.id;

                return (
                  <motion.div
                    key={mat.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden rounded-xl border bg-card shadow-soft"
                  >
                    {/* Top strip */}
                    <div className={`h-0.5 w-full ${isPaid ? "bg-gradient-to-r from-amber-400 to-orange-500" : "bg-gradient-to-r from-primary to-primary/50"}`} />

                    <div className="flex items-start gap-3 px-4 py-3 sm:py-4">
                      {/* File type icon */}
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${ft.bg}`}>
                        <Icon className={`h-4 w-4 ${ft.color}`} />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm leading-snug truncate">{mat.title}</span>
                          {isPaid ? (
                            <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              <Lock className="h-2.5 w-2.5" /> {mat.currency} {mat.price.toLocaleString()}
                            </span>
                          ) : (
                            <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                              Free
                            </span>
                          )}
                          {mat.courseCode && (
                            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{mat.courseCode}</span>
                          )}
                        </div>

                        {mat.description && (
                          <p className={`mt-0.5 text-xs text-muted-foreground ${isExpanded ? "" : "line-clamp-1"}`}>
                            {mat.description}
                          </p>
                        )}

                        <p className="mt-1 text-[10px] text-muted-foreground/60">
                          Added {new Date(mat.uploadedAt).toLocaleDateString()}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <a href={mat.url} target="_blank" rel="noopener noreferrer">
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Open link">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                        {mat.description && (
                          <Button
                            size="icon" variant="ghost" className="h-8 w-8"
                            onClick={() => setExpandedId(isExpanded ? null : mat.id)}
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                        <Button
                          size="icon" variant="ghost"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          disabled={deletingId === mat.id}
                          onClick={() => handleDelete(mat.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {/* Empty after dismissing prompt */}
      {!hasExisting && promptAnswer === false && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="mt-8 flex flex-col items-center rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center"
        >
          <BookOpen className="h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">No materials uploaded yet.</p>
          <Button onClick={openAddForm} variant="outline" size="sm" className="mt-4 gap-2">
            <Plus className="h-4 w-4" /> Upload your first material
          </Button>
        </motion.div>
      )}
    </main>
  );
}
