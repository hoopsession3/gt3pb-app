"use client";

import dynamic from "next/dynamic";

// THE VENUE PICK, LOADED WITH WHAT SHOWS IT (2026-10-05, the form audit, part 4). Every screen that
// names a stop's or an event's venue imports components/VenuePick through here: it appears only inside
// an opened card or a sheet. Imported directly, it put 4,034 bytes gzipped on /crew's first load before
// anyone opened either; through here /crew loads 1,245 bytes less than before the pick existed (the old
// vendor <select> and FieldOpSheet's save-time vendor matching left with it) — both measured against
// main, 2026-10-05. The space the pick takes is held while it loads, so the fields under it stay put.
const VenuePick = dynamic(() => import("./VenuePick"), { ssr: false, loading: () => <div className="venue-loading" aria-busy="true" /> });
export default VenuePick;
