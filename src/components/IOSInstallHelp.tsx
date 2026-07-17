import { AnimatePresence, motion } from "framer-motion";
import { Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface IOSInstallHelpProps {
  open: boolean;
  onClose: () => void;
}

export function IOSInstallHelp({ open, onClose }: IOSInstallHelpProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ duration: 0.25, ease: "circOut" }}
            className="relative w-full max-w-sm rounded-2xl border bg-card p-6 shadow-soft"
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold">Install Attendly on iPhone/iPad</h2>
            <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">1</span>
                <span className="pt-0.5">
                  Tap the <Share className="mx-1 inline h-4 w-4 align-text-bottom" /> Share icon in Safari's toolbar.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">2</span>
                <span className="pt-0.5">
                  Scroll down and tap <SquarePlus className="mx-1 inline h-4 w-4 align-text-bottom" /> <span className="font-medium text-foreground">Add to Home Screen</span>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">3</span>
                <span className="pt-0.5">Tap <span className="font-medium text-foreground">Add</span> to confirm.</span>
              </li>
            </ol>
            <Button className="mt-6 w-full" onClick={onClose}>Got it</Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
