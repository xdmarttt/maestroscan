import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { Platform, Alert } from "react-native";
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  ErrorCode,
  type ProductOrSubscription,
  type Purchase,
  type PurchaseError,
} from "react-native-iap";
import { supabase } from "@/lib/supabase";
import { useScanLimit } from "@/lib/scan-limit-context";

// ─── Product IDs ─────────────────────────────────────────────────────────────

export const IAP_PRODUCTS = {
  SOLO_MONTHLY: "com.maestroscan.solo.monthly",
  SOLO_YEARLY: "com.maestroscan.solo.yearly",
} as const;

export const IAP_SKU_LIST = [
  IAP_PRODUCTS.SOLO_MONTHLY,
  IAP_PRODUCTS.SOLO_YEARLY,
];

// ─── Context ─────────────────────────────────────────────────────────────────

interface IAPContextValue {
  products: ProductOrSubscription[];
  isLoading: boolean;
  isPurchasing: boolean;
  purchaseSuccess: boolean;
  purchase: (sku: string) => Promise<void>;
}

const IAPContext = createContext<IAPContextValue>({
  products: [],
  isLoading: true,
  isPurchasing: false,
  purchaseSuccess: false,
  purchase: async () => {},
});

export function useIAP() {
  return useContext(IAPContext);
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function IAPProvider({ children }: { children: React.ReactNode }) {
  const { refresh: refreshScanLimit } = useScanLimit();
  const [products, setProducts] = useState<ProductOrSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);

  // Use ref so listeners always have fresh reference
  const refreshRef = useRef(refreshScanLimit);
  refreshRef.current = refreshScanLimit;

  // Initialize connection + fetch products (once)
  useEffect(() => {
    if (Platform.OS === "web") {
      setIsLoading(false);
      return;
    }

    async function init() {
      try {
        await initConnection();
        console.log("IAP: connected");

        const fetched = await fetchProducts({
          skus: IAP_SKU_LIST,
          type: "subs",
        });
        if (fetched) {
          console.log("IAP: fetched products:", fetched.map((p) => p.id));
          setProducts(fetched);
        }
      } catch (err) {
        console.error("IAP init error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    init();

    // Purchase success listener
    const purchaseUpdateSub = purchaseUpdatedListener(
      async (purchase: Purchase) => {
        console.log("IAP: purchase updated:", purchase.productId);
        try {
          // Get org ID fresh — never rely on stale closure
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Not authenticated");

          const { data: prof } = await supabase
            .from("profiles")
            .select("organization_id")
            .eq("id", user.id)
            .single();

          const orgId = prof?.organization_id;
          if (!orgId) throw new Error("No organization found for your account");

          // Sync to Supabase via RPC (bypasses RLS)
          const { error: rpcError } = await (supabase.rpc as any)(
            "activate_apple_subscription",
            {
              p_organization_id: orgId,
              p_product_id: purchase.productId,
              p_transaction_id: purchase.id ?? "",
            }
          );

          if (rpcError) {
            throw new Error(rpcError.message);
          }

          await finishTransaction({ purchase, isConsumable: false });

          // Refresh scan limit so UI picks up "solo" tier
          await refreshRef.current();
          setPurchaseSuccess(true);

          Alert.alert(
            "Success!",
            "You are now subscribed to Solo. Enjoy unlimited scanning!"
          );
        } catch (err: any) {
          console.error("IAP: purchase handler error:", err);
          Alert.alert(
            "Activation Error",
            err?.message ?? "Purchase succeeded but activation failed. Please contact support."
          );
        } finally {
          setIsPurchasing(false);
        }
      }
    );

    // Purchase error listener
    const purchaseErrorSub = purchaseErrorListener((error: PurchaseError) => {
      console.error("IAP: purchase error:", JSON.stringify(error));
      if (error.code !== ErrorCode.UserCancelled) {
        Alert.alert(
          "Purchase Error",
          error.message ?? "Something went wrong. Please try again."
        );
      }
      setIsPurchasing(false);
    });

    return () => {
      purchaseUpdateSub?.remove();
      purchaseErrorSub?.remove();
      endConnection();
    };
  }, []); // Only run once — listeners use refs for fresh data

  const purchase = useCallback(
    async (sku: string) => {
      if (Platform.OS === "web") {
        Alert.alert("Not Available", "In-app purchases are only available on mobile devices.");
        return;
      }

      const product = products.find((p) => p.id === sku);
      if (!product) {
        Alert.alert(
          "Product Not Found",
          `This subscription is not available right now. (Found: ${products.map((p) => p.id).join(", ") || "none"})`
        );
        return;
      }

      setPurchaseSuccess(false);
      setIsPurchasing(true);

      // Safety timeout — if neither listener fires in 60s, reset the button
      const timeout = setTimeout(() => {
        setIsPurchasing((current) => {
          if (current) {
            Alert.alert(
              "Purchase Timeout",
              "The purchase is taking too long. If you were charged, your subscription will activate automatically. Try restarting the app."
            );
          }
          return false;
        });
      }, 60000);

      try {
        console.log("IAP: requesting purchase for:", sku);
        await requestPurchase({
          request: { apple: { sku } },
          type: "subs",
        });
      } catch (err: any) {
        clearTimeout(timeout);
        console.error("IAP: requestPurchase error:", JSON.stringify(err));
        if (err?.code !== ErrorCode.UserCancelled) {
          Alert.alert(
            "Purchase Error",
            err?.message ?? "Something went wrong. Please try again."
          );
        }
        setIsPurchasing(false);
      }
    },
    [products]
  );

  return (
    <IAPContext.Provider
      value={{ products, isLoading, isPurchasing, purchaseSuccess, purchase }}
    >
      {children}
    </IAPContext.Provider>
  );
}
