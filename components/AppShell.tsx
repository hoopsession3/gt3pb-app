"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "./AppProvider";
import BottomNav from "./BottomNav";
import OperatorNav, { OperatorSectionProvider } from "./OperatorNav";
import QuickDock from "./QuickDock";
import CartBar from "./CartBar";
import OrderStatus from "./OrderStatus";
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

  // Day mode: the crew console defaults to a light theme for daylight/outdoor use. Persisted;
  // toggle back to dark anytime. Customer-facing pages are unaffected.
  const [theme, setTheme] = useState<"day" | "dark">("day");
  useEffect(() => { const t = typeof window !== "undefined" ? localStorage.getItem("gt3-theme") : null; if (t === "dark" || t === "day") setTheme(t); }, []);
  const toggleTheme = () => { const t = theme === "day" ? "dark" : "day"; setTheme(t); if (typeof window !== "undefined") localStorage.setItem("gt3-theme", t); };

  return (
    <OperatorSectionProvider>
      <div className={`app${inAdmin && theme === "day" ? " crew-day" : ""}`}>
        <div className="body" ref={bodyRef} id="body">
          {children}
        </div>
        <DrinkSheet />
        <Checkout />
        <Toast />
        <Notifications />
        {inAdmin ? null : <OrderStatus />}
        {inAdmin ? null : <CartBar />}
        {inAdmin ? <OperatorNav /> : <BottomNav />}
        {inAdmin && <QuickDock />}
        {inAdmin && <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={theme === "day" ? "Switch to dark" : "Switch to day"}>{theme === "day" ? "🌙" : "☀️"}</button>}
        <ServiceWorkerRegister />
      </div>
    </OperatorSectionProvider>
  );
}
