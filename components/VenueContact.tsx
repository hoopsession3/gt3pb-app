"use client";

import type { BookVenue } from "@/lib/venues";

// A VENUE'S PEOPLE, FROM THE BOOK (2026-10-05, the form audit, part 4) — its liaison, how to reach them,
// and when it runs: under the venue pick on the event card (components/VenuePick) and on Route's stop
// card (components/crew/LocationEditor), which says a stop's venue and leaves the pick to its sheet. A
// file of its own so Route's card does not carry the pick into the console's first load.
export default function VenueContact({ venue }: { venue: Pick<BookVenue, "poc_name" | "poc_phone" | "poc_email" | "service_dates"> }) {
  if (!venue.poc_name && !venue.poc_phone && !venue.poc_email && !venue.service_dates) return null;
  return (
    <div className="vlink">
      {venue.poc_name && <div className="vlink-row"><span>Liaison</span><b>{venue.poc_name}</b></div>}
      {venue.poc_phone && <div className="vlink-row"><span>Phone</span><a href={`tel:${venue.poc_phone}`}>{venue.poc_phone}</a></div>}
      {venue.poc_email && <div className="vlink-row"><span>Email</span><a href={`mailto:${venue.poc_email}`}>{venue.poc_email}</a></div>}
      {venue.service_dates && <div className="vlink-row"><span>Service</span><b>{venue.service_dates}</b></div>}
      <div className="vlink-note">From the venue book — change them there, and every stop and event at this venue reads the change.</div>
    </div>
  );
}
