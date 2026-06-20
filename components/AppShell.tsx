"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import BottomNav from "./BottomNav";
import DrinkSheet from "./DrinkSheet";
import Toast from "./Toast";
import Notifications from "./Notifications";
import ServiceWorkerRegister from "./ServiceWorkerRegister";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bodyRef = useRef<HTMLDivElement>(null);
  const { closeDrink } = useApp();

  // Mirror the prototype go(): scroll to top + close any open sheet on navigation.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    closeDrink();
  }, [pathname, closeDrink]);

  return (
    <div className="app">
      <div className="body" ref={bodyRef} id="body">
        {children}
      </div>
      <DrinkSheet />
      <Toast />
      <Notifications />
      <BottomNav />
      <ServiceWorkerRegister />
    </div>
  );
}
