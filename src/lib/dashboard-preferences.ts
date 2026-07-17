import type { CSSProperties } from "react";

// ── Dashboard color theme ───────────────────────────────────────────────────

export type ThemeId =
  | "default"
  | "classic-corporate"
  | "dark-tech"
  | "minimal-monochrome"
  | "finance-analytics"
  | "warm-saas"
  | "earth-tone";

export interface DashboardTheme {
  id: ThemeId;
  name: string;
  description: string;
  /** Preview dots shown on the theme's swatch card */
  swatches: string[];
  /** CSS custom properties to override on the dashboard root. `null` = keep the app default theme. */
  vars: Record<string, string> | null;
}

export const DASHBOARD_THEMES: DashboardTheme[] = [
  {
    id: "default",
    name: "Default (Mint)",
    description: "Attendly's original green & white look.",
    swatches: ["#10B981", "#F8FAFC", "#0F172A"],
    vars: null,
  },
  {
    id: "classic-corporate",
    name: "Classic Corporate",
    description: "Trustworthy blue, built for institutions.",
    swatches: ["#2563EB", "#64748B", "#10B981", "#EF4444"],
    vars: {
      "--background": "#F8FAFC",
      "--foreground": "#0F172A",
      "--card": "#FFFFFF",
      "--card-foreground": "#0F172A",
      "--popover": "#FFFFFF",
      "--popover-foreground": "#0F172A",
      "--primary": "#2563EB",
      "--primary-foreground": "#FFFFFF",
      "--primary-glow": "#60A5FA",
      "--secondary": "#F1F5F9",
      "--secondary-foreground": "#0F172A",
      "--muted": "#F1F5F9",
      "--muted-foreground": "#64748B",
      "--accent": "#DBEAFE",
      "--accent-foreground": "#1E3A8A",
      "--destructive": "#EF4444",
      "--destructive-foreground": "#FFFFFF",
      "--success": "#10B981",
      "--success-foreground": "#FFFFFF",
      "--warning": "#F59E0B",
      "--warning-foreground": "#1F2937",
      "--border": "#E2E8F0",
      "--input": "#E2E8F0",
      "--ring": "#2563EB",
    },
  },
  {
    id: "dark-tech",
    name: "Dark Mode Tech",
    description: "Deep navy surfaces with a bright blue accent.",
    swatches: ["#0F172A", "#3B82F6", "#A78BFA", "#F1F5F9"],
    vars: {
      "--background": "#0F172A",
      "--foreground": "#F1F5F9",
      "--card": "#1E293B",
      "--card-foreground": "#F1F5F9",
      "--popover": "#1E293B",
      "--popover-foreground": "#F1F5F9",
      "--primary": "#3B82F6",
      "--primary-foreground": "#FFFFFF",
      "--primary-glow": "#93C5FD",
      "--secondary": "#1E293B",
      "--secondary-foreground": "#F1F5F9",
      "--muted": "#1E293B",
      "--muted-foreground": "#94A3B8",
      "--accent": "#A78BFA",
      "--accent-foreground": "#1E1B4B",
      "--destructive": "#EF4444",
      "--destructive-foreground": "#FFFFFF",
      "--success": "#10B981",
      "--success-foreground": "#FFFFFF",
      "--warning": "#F59E0B",
      "--warning-foreground": "#1F2937",
      "--border": "#334155",
      "--input": "#334155",
      "--ring": "#3B82F6",
    },
  },
  {
    id: "minimal-monochrome",
    name: "Minimal Monochrome",
    description: "Clean black & white with a single orange pop.",
    swatches: ["#FFFFFF", "#1F2937", "#9CA3AF", "#F97316"],
    vars: {
      "--background": "#FFFFFF",
      "--foreground": "#1F2937",
      "--card": "#FFFFFF",
      "--card-foreground": "#1F2937",
      "--popover": "#FFFFFF",
      "--popover-foreground": "#1F2937",
      "--primary": "#F97316",
      "--primary-foreground": "#FFFFFF",
      "--primary-glow": "#FDBA74",
      "--secondary": "#E5E7EB",
      "--secondary-foreground": "#1F2937",
      "--muted": "#E5E7EB",
      "--muted-foreground": "#9CA3AF",
      "--accent": "#FFEDD5",
      "--accent-foreground": "#7C2D12",
      "--destructive": "#EF4444",
      "--destructive-foreground": "#FFFFFF",
      "--success": "#10B981",
      "--success-foreground": "#FFFFFF",
      "--warning": "#F59E0B",
      "--warning-foreground": "#1F2937",
      "--border": "#E5E7EB",
      "--input": "#E5E7EB",
      "--ring": "#F97316",
    },
  },
  {
    id: "finance-analytics",
    name: "Finance / Analytics",
    description: "Clear green-red signals for gains and losses.",
    swatches: ["#0EA5E9", "#16A34A", "#DC2626", "#475569"],
    vars: {
      "--background": "#F9FAFB",
      "--foreground": "#0F172A",
      "--card": "#FFFFFF",
      "--card-foreground": "#0F172A",
      "--popover": "#FFFFFF",
      "--popover-foreground": "#0F172A",
      "--primary": "#0EA5E9",
      "--primary-foreground": "#FFFFFF",
      "--primary-glow": "#7DD3FC",
      "--secondary": "#F1F5F9",
      "--secondary-foreground": "#0F172A",
      "--muted": "#F1F5F9",
      "--muted-foreground": "#475569",
      "--accent": "#E0F2FE",
      "--accent-foreground": "#075985",
      "--destructive": "#DC2626",
      "--destructive-foreground": "#FFFFFF",
      "--success": "#16A34A",
      "--success-foreground": "#FFFFFF",
      "--warning": "#F59E0B",
      "--warning-foreground": "#1F2937",
      "--border": "#E2E8F0",
      "--input": "#E2E8F0",
      "--ring": "#0EA5E9",
    },
  },
  {
    id: "warm-saas",
    name: "Warm & Friendly SaaS",
    description: "Indigo and pink with a bright yellow accent.",
    swatches: ["#6366F1", "#EC4899", "#FBBF24", "#FAFAFA"],
    vars: {
      "--background": "#FAFAFA",
      "--foreground": "#27272A",
      "--card": "#FFFFFF",
      "--card-foreground": "#27272A",
      "--popover": "#FFFFFF",
      "--popover-foreground": "#27272A",
      "--primary": "#6366F1",
      "--primary-foreground": "#FFFFFF",
      "--primary-glow": "#A5B4FC",
      "--secondary": "#F4F4F5",
      "--secondary-foreground": "#27272A",
      "--muted": "#F4F4F5",
      "--muted-foreground": "#71717A",
      "--accent": "#FCE7F3",
      "--accent-foreground": "#9D174D",
      "--destructive": "#EF4444",
      "--destructive-foreground": "#FFFFFF",
      "--success": "#10B981",
      "--success-foreground": "#FFFFFF",
      "--warning": "#FBBF24",
      "--warning-foreground": "#1F2937",
      "--border": "#E4E4E7",
      "--input": "#E4E4E7",
      "--ring": "#6366F1",
    },
  },
  {
    id: "earth-tone",
    name: "Earth-tone Professional",
    description: "Teal and brown on a warm cream background.",
    swatches: ["#0F766E", "#92400E", "#FFFBEB", "#DC2626"],
    vars: {
      "--background": "#FFFBEB",
      "--foreground": "#1F2937",
      "--card": "#FFFFFF",
      "--card-foreground": "#1F2937",
      "--popover": "#FFFFFF",
      "--popover-foreground": "#1F2937",
      "--primary": "#0F766E",
      "--primary-foreground": "#FFFFFF",
      "--primary-glow": "#2DD4BF",
      "--secondary": "#FEF3C7",
      "--secondary-foreground": "#78350F",
      "--muted": "#FEF3C7",
      "--muted-foreground": "#92400E",
      "--accent": "#DC2626",
      "--accent-foreground": "#FFFFFF",
      "--destructive": "#DC2626",
      "--destructive-foreground": "#FFFFFF",
      "--success": "#10B981",
      "--success-foreground": "#FFFFFF",
      "--warning": "#F59E0B",
      "--warning-foreground": "#1F2937",
      "--border": "#FDE68A",
      "--input": "#FDE68A",
      "--ring": "#0F766E",
    },
  },
];

const THEME_KEY = "att.admin.theme.v1";

export function loadDashboardTheme(): ThemeId {
  if (typeof window === "undefined") return "default";
  return (localStorage.getItem(THEME_KEY) as ThemeId) || "default";
}

export function saveDashboardTheme(id: ThemeId) {
  localStorage.setItem(THEME_KEY, id);
  window.dispatchEvent(new Event("att:theme"));
}

export function getThemeVars(id: ThemeId): CSSProperties {
  const theme = DASHBOARD_THEMES.find((t) => t.id === id);
  return (theme?.vars as CSSProperties) || {};
}

// ── Developer access ────────────────────────────────────────────────────────

const DEV_ACCESS_KEY = "att.admin.devAccess.v1";

export function loadDeveloperAccess(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEV_ACCESS_KEY) === "1";
}

export function saveDeveloperAccess(enabled: boolean) {
  localStorage.setItem(DEV_ACCESS_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new Event("att:devaccess"));
}

// ── Onboarding wizard completion ────────────────────────────────────────────

const ONBOARDING_KEY = "att.admin.onboardingDone.v1";

export function isOnboardingDone(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(ONBOARDING_KEY) === "1";
}

export function markOnboardingDone() {
  localStorage.setItem(ONBOARDING_KEY, "1");
}
