// THE RUN'S PROGRESS BAR (2026-10-07) — one for the porch run (DriverRun) and the office route
// (OfficeRun): the driver's screen has one bar, and the bar has one definition. Its width is the one
// inline style here — a fraction of the run, not layout. VoiceOver reads it as progress ("3 of 6 done").
export default function RunBar({ done, of }: { done: number; of: number }) {
  return (
    <div className="driver-bar" role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={done} aria-label={`${done} of ${of} done`}>
      <span style={{ width: `${of ? (done / of) * 100 : 0}%` }} />
    </div>
  );
}
