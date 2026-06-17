"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Phase 입력은 이제 대시보드(/morning)에서 인라인으로 처리됩니다.
export default function PhaseRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/morning");
  }, [router]);
  return null;
}
