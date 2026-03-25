import { supabase } from "@/lib/supabase";

// ─── Plan Limits ─────────────────────────────────────────────────────────────

export type SubscriptionTier = "free" | "solo" | "school" | "enterprise";

export interface PlanLimits {
  maxScansPerMonth: number | null; // null = unlimited
}

const PLAN_LIMITS: Record<SubscriptionTier, PlanLimits> = {
  free: { maxScansPerMonth: 200 },
  solo: { maxScansPerMonth: null },
  school: { maxScansPerMonth: null },
  enterprise: { maxScansPerMonth: null },
};

export function getLimitsForTier(tier: SubscriptionTier): PlanLimits {
  return PLAN_LIMITS[tier] ?? PLAN_LIMITS.free;
}

// ─── Usage Queries ───────────────────────────────────────────────────────────

function getMonthStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export async function getScansUsedThisMonth(
  organizationId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("answer_sheets")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("scanned_at", getMonthStartIso());

  if (error) {
    console.error("getScansUsedThisMonth error:", error);
    return 0;
  }
  return count ?? 0;
}

export async function getOrganizationTier(
  organizationId: string
): Promise<SubscriptionTier> {
  const { data, error } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .single();

  if (error || !data?.subscription_tier) return "free";
  return (data.subscription_tier as SubscriptionTier) ?? "free";
}
