import { useState, useMemo, useEffect } from "react";
import { Loader2, CreditCard, AlertCircle, CheckCircle2, Info, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { calcFees, hasUserPaidForMaterial, savePurchaseToken } from "@/lib/squad";
import { confirmMaterialPayment, startMaterialPayment } from "@/lib/payments-server";

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  materialId: string;
  materialTitle: string;
  /** Lecturer's listed price in NGN */
  amount: number;
  currency: string;
  onSuccess: () => void;
  studentMatricNumber?: string;
  /** Lecturer payout info */
  lecturerAccountNumber?: string;
  lecturerBankCode?: string;
  lecturerAccountName?: string;
}

type Step = "form" | "processing" | "success" | "failed";

export function PaymentModal({
  open, onClose,
  materialId, materialTitle,
  amount, currency,
  onSuccess,
  studentMatricNumber,
  lecturerAccountNumber, lecturerBankCode, lecturerAccountName,
}: PaymentModalProps) {
  const [step, setStep] = useState<Step>("form");
  const [matricConfirm, setMatricConfirm] = useState(studentMatricNumber || "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [txRef, setTxRef] = useState<string>("");
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  // ── Fee breakdown ───────────────────────────────────────────────────────────
  const fees = useMemo(() => calcFees(amount), [amount]);

  // ── Check if user has already paid for this material ───────────────────────
  useEffect(() => {
    if (open && matricConfirm) {
      const hasPaid = hasUserPaidForMaterial(materialId, matricConfirm);
      if (hasPaid) {
        setAlreadyPaid(true);
        setStep("success");
        toast.success("You have already purchased this material!");
        onSuccess();
      }
    }
  }, [open, materialId, matricConfirm, onSuccess]);

  // ── Poll for payment verification once checkout opens ──────────────────────
  useEffect(() => {
    if (step !== "processing" || !txRef) return;

    let attempts = 0;
    const MAX = 60; // 2 min at 2s intervals
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (attempts >= MAX) {
        setStep("failed");
        setLoading(false);
        toast.error("Payment verification timed out. Contact support if you were charged.");
        return;
      }
      attempts++;

      try {
        console.log(`[Payment Poll] Attempt ${attempts}/${MAX} for transaction ${txRef}`);
        const res = await confirmMaterialPayment({ data: { transactionRef: txRef } });
        if (res.state === "success") {
          handlePaymentSuccess(res.accessToken);
          return;
        }
        if (res.state === "failed" || res.state === "not_found") {
          setStep("failed");
          setLoading(false);
          toast.error("Payment was not completed.");
          return;
        }
        if (res.state === "amount_mismatch") {
          setStep("failed");
          setLoading(false);
          toast.error("The amount paid didn't match the price. Contact your lecturer with your payment reference.");
          return;
        }
      } catch (err) {
        console.error("Payment verification error:", err);
        // network hiccup — keep polling
      }

      timer = setTimeout(poll, 2000);
    }

    timer = setTimeout(poll, 3000); // first check after 3s
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, txRef]);

  // ── After the server confirmed the payment ─────────────────────────────────
  function handlePaymentSuccess(accessToken: string) {
    // The token proves the purchase to the server when opening the file;
    // the server already recorded the purchase and paid the lecturer.
    savePurchaseToken(materialId, accessToken);
    setStep("success");
    setLoading(false);
    toast.success("Payment successful! Access unlocked.");
    onSuccess();
  }

  // ── Initiate payment ────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!matricConfirm.trim() || !name.trim() || !phone.trim()) {
      return toast.error("Please fill in all fields.");
    }
    // Basic matric confirmation — must not be empty
    if (matricConfirm.trim().length < 3) {
      return toast.error("Please enter a valid matric number.");
    }

    setLoading(true);

    try {
      // Price, fees and the reference are decided by the server
      const res = await startMaterialPayment({
        data: {
          materialId,
          matric: matricConfirm.trim().toUpperCase(),
          name: name.trim(),
          phone: phone.trim(),
          origin: window.location.origin,
        },
      });
      if (!res.ok) throw new Error(res.message);
      setTxRef(res.transactionRef);
      const url = res.checkoutUrl;
      setCheckoutUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
      setStep("processing");
    } catch (err) {
      console.error("Payment initiation error:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to start payment.";
      
      // Provide more helpful error messages for common issues
      if (/Squad secret key not configured|SUPABASE_SERVICE_ROLE_KEY/.test(errorMessage)) {
        toast.error("Payment system not configured. Please contact support.");
      } else if (errorMessage.includes("Squad API error")) {
        toast.error("Payment service temporarily unavailable. Please try again later.");
      } else {
        toast.error(errorMessage);
      }
      setLoading(false);
    }
  }

  function handleClose() {
    if (step === "processing") {
      toast.warning("Payment is in progress — please complete it in the opened window.");
      return;
    }
    onClose();
    setStep("form");
    setMatricConfirm(""); setName(""); setPhone(""); setCheckoutUrl(null); setLoading(false); setTxRef("");
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">

        {/* ── Form step ── */}
        {step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" /> Pay for Material
              </DialogTitle>
              <DialogDescription>{materialTitle}</DialogDescription>
            </DialogHeader>

            {/* Fee breakdown */}
            <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800/40 dark:bg-blue-900/20 p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-blue-800 dark:text-blue-300 mb-1">
                <Info className="h-3.5 w-3.5" /> Payment breakdown
              </div>
              <div className="flex justify-between text-blue-700 dark:text-blue-400">
                <span>Material price</span><span>₦{fees.lecturerPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-blue-700 dark:text-blue-400">
                <span>Processing fee (gateway)</span><span>₦{fees.platformFee.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-blue-700 dark:text-blue-400">
                <span>Transfer fee</span><span>₦{fees.transferFee.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-blue-700 dark:text-blue-400">
                <span>Payment gateway (1.2%)</span><span>₦{fees.squadFee.toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-bold text-blue-900 dark:text-blue-200 border-t border-blue-200 dark:border-blue-700 pt-1.5">
                <span>Total you pay</span><span>₦{fees.totalCharge.toLocaleString()}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <Label htmlFor="sq-matric">Matric Number</Label>
                <Input
                  id="sq-matric"
                  value={matricConfirm}
                  onChange={(e) => setMatricConfirm(e.target.value)}
                  placeholder="e.g. CSC/2021/001"
                  className="mt-1"
                  required
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Enter your matric number to confirm this purchase is tied to your identity.
                </p>
              </div>
              <div>
                <Label htmlFor="sq-name">Full Name</Label>
                <Input id="sq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="mt-1" required />
              </div>
              <div>
                <Label htmlFor="sq-phone">Phone Number</Label>
                <Input id="sq-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08012345678" className="mt-1" required />
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Pay ₦{fees.totalCharge.toLocaleString()}
                </Button>
              </div>
            </form>
          </>
        )}

        {/* ── Processing step ── */}
        {step === "processing" && (
          <div className="flex flex-col items-center py-8 gap-4 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <h3 className="text-lg font-semibold">Waiting for payment…</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              A Squad checkout window should have opened in a new tab. Don't see it, or accidentally closed it? Click the button below to reopen it and continue your payment.
            </p>
            {checkoutUrl && (
              <Button size="sm" onClick={() => window.open(checkoutUrl, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="mr-2 h-4 w-4" /> Reopen checkout window to continue
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setStep("failed")} className="text-xs text-muted-foreground">
              Payment completed? Click here to verify
            </Button>
          </div>
        )}

        {/* ── Success step ── */}
        {step === "success" && (
          <div className="flex flex-col items-center py-8 gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-lg font-semibold">Payment Successful!</h3>
            <p className="text-sm text-muted-foreground">You now have access to <span className="font-medium">{materialTitle}</span>.</p>
            <Button className="mt-2" onClick={handleClose}>Close</Button>
          </div>
        )}

        {/* ── Failed step ── */}
        {step === "failed" && (
          <div className="flex flex-col items-center py-8 gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-lg font-semibold">Payment Failed</h3>
            <p className="text-sm text-muted-foreground">The payment was not completed. Please try again.</p>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button onClick={() => { setStep("form"); setLoading(false); }}>Try Again</Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
