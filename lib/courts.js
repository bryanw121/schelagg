// Court calendars by booking system. config/regions/<id>/courts.json lists each venue with its
// `system` (Skedda unless it says opencourt or usta); every reader returns the same shape (lib/skedda.js).
import { VENUES, loadVenue as loadSkedda } from './skedda.js';
import { loadOpenCourtVenue } from './opencourt-courts.js';
import { loadUstaVenue } from './usta-courts.js';

export { VENUES };
const READERS = { opencourt: loadOpenCourtVenue, usta: loadUstaVenue };
export const loadCourtVenue = (venue, fromIso, days, opts) => (READERS[venue.system] ?? loadSkedda)(venue, fromIso, days, opts);
