"use client";

import {  } from "react";
import { useAuth, roleOf } from "./AuthProvider";
import { useEditMode, writeEditMode } from "@/lib/editModeToggle";
import Icon from "@/components/Icon";

// The switch for EditableCopy's inline, on-page editing (see that file for the full picture) —
// lives in the float rail next to Display/Connect, same "quick action" home every owner-only or
// app-wide toggle already uses. Owner-only, same gate as EditCopyPill: this is real estate on
// customer-facing pages, and it's a switch that changes how EVERY piece of copy on the page
// behaves, so it stays out of the rail entirely for anyone who isn't the owner.
export default function EditModeToggle() {
  const { profile } = useAuth();
  const on = useEditMode();   // a store since R17 (lib/editModeToggle): every reader follows the switch, here and in other tabs
  if (roleOf(profile) !== "owner") return null;

  const toggle = () => writeEditMode(!on);

  return (
    <button type="button" className={`rdg-fab ec-toggle${on ? " on" : ""}`} onClick={toggle} aria-pressed={on} aria-label={on ? "Turn off on-page copy editing" : "Turn on on-page copy editing"}>
      <Icon name="edit" size={16} />
      <span className="rail-txt"><b>Edit copy</b><i>{on ? "On — click any text" : "Click text on the page"}</i></span>
    </button>
  );
}
