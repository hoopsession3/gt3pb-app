"use client";

import { useApp } from "./AppProvider";

export default function Toast() {
  const { toastMsg, toastShown } = useApp();
  return (
    <div className={`toast${toastShown ? " show" : ""}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5}>
        <path d="M5 12l5 5L20 7" />
      </svg>
      <span>{toastMsg}</span>
    </div>
  );
}
