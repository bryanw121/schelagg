// Court calendars by booking system. config/regions/<id>/courts.json lists each venue with its
// `system` (Skedda unless it says otherwise); every reader returns the same shape (lib/skedda.js).
import { VENUES, loadVenue as loadSkedda } from './skedda.js';
import { loadOpenCourtVenue } from './opencourt-courts.js';

export { VENUES };
export const loadCourtVenue = (venue, fromIso, days, opts) =>
  (venue.system === 'opencourt' ? loadOpenCourtVenue : loadSkedda)(venue, fromIso, days, opts);
