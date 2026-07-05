import { useState } from "react";
import { Loader2, CreditCard, Smartphone, QrCode, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  createOPayPaymentServer, checkPaymentStatusServer,
} from "@/lib/opay-server";
import {
  generateOrderId, savePaymentRecord,
  type OPayPaymentMethod, type OPayPaymentStatus, type PaymentRecord,
} from "@/lib/opay";
import { toast } from "sonner";

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  materialId: string;
  materialTitle: string;
  amount: number;
  currency: string;
  onSuccess: () => void;
}

const PAYMENT_METHODS: { value: OPayPaymentMethod; label: string; icon: React.ElementType }[] = [
  { value: "BankCard", label: "Bank Card", icon: CreditCard },
  { value: "BankTransfer", label: "Bank Transfer", icon: CreditCard },
  { value: "OpayWalletNg", label: "OPay Wallet", icon: Smartphone },
  { value: "OpayWalletNgQR", label: "OPay QR Code", icon: QrCode },
];

export function PaymentModal({
  open, onClose, materialId, materialTitle, amount, currency, onSuccess,
}: PaymentModalProps) {
  const [step, setStep] = useState<"form" | "processing" | "success" | "failed">("form");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payMethod, setPayMethod] = useState<OPayPaymentMethod>("BankCard");
  const [loading, setLoading] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !name || !phone) {
      return toast.error("Please fill all fields");
    }

    setLoading(true);
    setStep("processing");

    try {
      const orderId = generateOrderId();
      const response = await createOPayPaymentServer({
        data: {
          amount,
          currency,
          orderId,
          materialId,
          materialTitle,
          customerEmail: email,
          customerName: name,
          customerPhone: phone,
          payMethod,
        },
      });

      // OPay returns code "00000" (string) for success
      if ((response.code === "00000" || response.code === 0) && (response.data?.cashierUrl || response.data?.cashUrl)) {
        // Save pending payment record
        const record: PaymentRecord = {
          id: crypto.randomUUID(),
          orderId,
          materialId,
          materialTitle,
          amount,
          currency,
          status: "pending",
          customerEmail: email,
          customerName: name,
          customerPhone: phone,
          payMethod,
          reference: response.data.reference,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await savePaymentRecord(record);

        setPaymentUrl(response.data.cashierUrl || response.data.cashUrl);
        
        // Open OPay checkout in new window
        window.open(response.data.cashierUrl || response.data.cashUrl, "_blank");
        
        // Start polling for payment status
        pollPaymentStatus(orderId);
      } else {
        throw new Error(response.message || "Payment initialization failed");
      }
    } catch (error) {
      console.error("Payment error:", error);
      toast.error(error instanceof Error ? error.message : "Payment failed");
      setStep("form");
      setLoading(false);
    }
  };

  const pollPaymentStatus = async (orderId: string) => {
    const maxAttempts = 30; // 30 attempts with 2-second intervals = 1 minute
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setStep("failed");
        setLoading(false);
        toast.error("Payment verification timed out");
        return;
      }

      attempts++;
      try {
        const response = await checkPaymentStatusServer({
          data: { orderId },
        });
        
        if (response.code === 0 && response.data) {
          // Check if payment was successful
          // OPay status values: INITIAL, PENDING, SUCCESS, FAIL, CLOSE
          const status = (response.data.status as string)?.toUpperCase();
          
          if (status === "SUCCESS") {
            setStep("success");
            setLoading(false);
            toast.success("Payment successful!");
            onSuccess();
            
            // Update payment record
            const payments = JSON.parse(localStorage.getItem("att.payments.v1") || "[]");
            const updated = payments.map((p: PaymentRecord) => 
              p.orderId === orderId ? { ...p, status: "successful", transactionId: response.data?.transactionId, updatedAt: new Date().toISOString() } : p
            );
            localStorage.setItem("att.payments.v1", JSON.stringify(updated));
            return;
          } else if (status === "FAIL" || status === "CLOSE") {
            setStep("failed");
            setLoading(false);
            toast.error("Payment failed or was cancelled");
            return;
          }
        }
        
        // Continue polling
        setTimeout(poll, 2000);
      } catch (error) {
        console.error("Status check error:", error);
        // Continue polling even on error
        setTimeout(poll, 2000);
      }
    };

    poll();
  };

  const handleClose = () => {
    if (step === "processing") {
      toast.warning("Payment is being processed, please wait");
      return;
    }
    onClose();
    // Reset form
    setStep("form");
    setEmail("");
    setName("");
    setPhone("");
    setPayMethod("BankCard");
    setPaymentUrl(null);
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle>Pay for Material</DialogTitle>
              <DialogDescription>
                {materialTitle} · {currency} {amount.toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="080..."
                  required
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Pay {currency} {amount.toLocaleString()}
                </Button>
              </div>
            </form>
          </>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <h3 className="mt-4 text-lg font-semibold">Processing Payment</h3>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Please complete the payment in the opened window. We're waiting for confirmation...
            </p>
            {paymentUrl && (
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => window.open(paymentUrl, "_blank")}
              >
                Open Payment Window Again
              </Button>
            )}
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Payment Successful!</h3>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              You can now access the study material.
            </p>
            <Button className="mt-4" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}

        {step === "failed" && (
          <div className="flex flex-col items-center py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Payment Failed</h3>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              The payment was not completed. Please try again.
            </p>
            <div className="mt-4 flex gap-3">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={() => setStep("form")}>
                Try Again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
