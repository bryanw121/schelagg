// One-off check that Skedda serves calendar data to a plain script (no browser).
// Run from your own terminal: npm run test:skedda
import { VENUES, loadVenue } from '../lib/skedda.js';
import { today } from '../lib/time.js';

const from = today();
for (const v of VENUES) {
  try {
    const r = await loadVenue(v, from, 2);
    const courts = r.facilities.flatMap((f) => f.courts);
    const booked = courts.filter((c) => c.days[from]?.length).length;
    console.log(`OK   ${v.id}: ${courts.length} courts, ${booked} with bookings today, hours today ${JSON.stringify(r.hours[new Date().getDay()])}`);
  } catch (e) {
    console.log(`FAIL ${v.id}: ${e.message}`);
    process.exitCode = 1;
  }
}
