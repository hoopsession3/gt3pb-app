"use client";

import Sheet, { CloseButton } from "./Sheet";

// SIGNED IN BY A LINK THIS DEVICE DIDN'T ASK FOR (R9, lib/linkSignin). Shown once, with the account's email: the person
// who opened someone else's link sees whose account this is, and leaves it with one tap. A link they asked for on
// another device of theirs reads as theirs, and "That's me" closes it.
export default function LinkSigninNotice({ email, onKeep, onLeave }: { email: string; onKeep: () => void; onLeave: () => void }) {
  return (
    <Sheet open onClose={onKeep} label="Signed in by a link"
      header={<div className="collect-head"><b>Signed in by a link</b><CloseButton onClick={onKeep} /></div>}>
      <div className="dp-hint cfm-body">
        This device is now signed in as <b>{email}</b>. If that isn&apos;t your account, sign out — anything you add here would be theirs.
      </div>
      <div className="prod-actions cfm-actions">
        <button type="button" className="btn-ter" onClick={onLeave}>Not me — sign out</button>
        <button type="button" className="btn-pri" autoFocus onClick={onKeep}>That&apos;s me</button>
      </div>
    </Sheet>
  );
}
