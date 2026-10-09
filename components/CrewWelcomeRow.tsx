"use client";

// YOU'RE ON THE CREW (2026-10-08). Someone just brought onto the crew lands on the customer home, and
// the way over was the profile picture and then Crew Mode — which Ryan had to text Niño. A staff member
// who has never been on either side on this phone (lib/mode remembers none) gets this one row on the
// home (app/page.tsx decides when): it says so and goes over, opening the first-day guide. Once they
// have been on the crew side the app opens there by itself; whoever chose the customer side keeps it,
// and a member never sees it. The role arrives without signing out — AuthProvider reads it again when
// the app comes back to the screen — and the row appears then.

import { InfoRow } from "@/components/kit";
import { START_PATH } from "@/lib/crewStart";

// A whole page load, not router.push: the crew page reads the guide's link (?guide=start) once, as
// it loads (app/crew/page.tsx), and during an in-app navigation the address still says where you came
// from at that moment — a pushed link opened the crew side without its guide. The same reason every
// other link into the console that carries an instruction is a plain link (lib/urlParam).
export default function CrewWelcomeRow() {
  return (
    <div className="k-rows mt-4">
      <InfoRow lead="Crew" leadSub="new" name="You're on the GT3 crew" sub="Your first-day guide is ready"
        trailing={<span className="k-chip">Open</span>} onClick={() => window.location.assign(START_PATH)}
        ariaLabel="You're on the GT3 crew — open the crew side and your first-day guide" />
    </div>
  );
}
