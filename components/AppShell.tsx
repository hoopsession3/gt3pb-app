"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import BottomNav from "./BottomNav";
import OperatorNav, { OperatorSectionProvider } from "./OperatorNav";
import CartBar from "./CartBar";
import DrinkSheet from "./DrinkSheet";
import Checkout from "./Checkout";
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

  // Employee Mode: inside /admin the customer 5-tab nav is replaced by the
  // role-scoped operator console nav (OperatorNav falls back to the customer nav
  // for non-staff so they can still navigate away).
  const inAdmin = pathname.startsWith("/admin");

  return (
    <OperatorSectionProvider>
      <div className="app">
        <div className="body" ref={bodyRef} id="body">
          {children}
        </div>
        <DrinkSheet />
        <Checkout />
        <Toast />
        <Notifications />
        {inAdmin ? null : <CartBar />}
        {inAdmin ? <OperatorNav /> : <BottomNav />}
        <ServiceWorkerRegister />
      </div>
    </OperatorSectionProvider>
  );
}
