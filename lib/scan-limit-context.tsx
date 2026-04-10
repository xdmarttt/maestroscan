import React, { createContext, useContext, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getScansUsedThisMonth,
  getOrganizationTier,
  getLimitsForTier,
  type SubscriptionTier,
} from "@/lib/entitlements";

interface ScanLimitState {
  tier: SubscriptionTier;
  used: number;
  limit: number | null; // null = unlimited
  canScan: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
  increment: () => void;
}

const ScanLimitContext = createContext<ScanLimitState>({
  tier: "free",
  used: 0,
  limit: null,
  canScan: true,
  isLoading: false,
  refresh: async () => {},
  increment: () => {},
});

export function useScanLimit() {
  return useContext(ScanLimitContext);
}

export function ScanLimitProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [tier, setTier] = useState<SubscriptionTier>("free");
  const [used, setUsed] = useState(0);
  const [limit, setLimit] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile?.organization_id) return;
    setIsLoading(true);
    try {
      const [fetchedTier, count] = await Promise.all([
        getOrganizationTier(profile.organization_id),
        getScansUsedThisMonth(profile.organization_id),
      ]);
      const limits = getLimitsForTier(fetchedTier);
      setTier(fetchedTier);
      setLimit(limits.maxScansPerMonth);
      setUsed(count);
    } catch (e) {
      console.error("ScanLimit refresh error:", e);
    } finally {
      setIsLoading(false);
    }
  }, [profile?.organization_id]);

  // Local increment after a successful save — avoids re-fetching
  const increment = useCallback(() => {
    setUsed((prev) => prev + 1);
  }, []);

  const canScan = limit === null || used < limit;

  return (
    <ScanLimitContext.Provider
      value={{ tier, used, limit, canScan, isLoading, refresh, increment }}
    >
      {children}
    </ScanLimitContext.Provider>
  );
}
