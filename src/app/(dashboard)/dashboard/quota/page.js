import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../usage/components/ProviderLimits";
import OpenRouterAccountCard from "../usage/components/OpenRouterAccountCard";

export default function QuotaPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <OpenRouterAccountCard />
      <Suspense fallback={<CardSkeleton />}>
        <ProviderLimits />
      </Suspense>
    </div>
  );
}
