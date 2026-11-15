// Minimal, synthetic records matching the public pages; no player/contact data.
export function page(value) {
  const record = `1:${JSON.stringify(value)}\n`;
  const split = Math.floor(record.length / 2);
  return [record.slice(0, split), record.slice(split)].map((s) => `<script>self.__next_f.push(${JSON.stringify([1, s])})</script>`).join('');
}
export const directory = { initialData: {
  mode: 'live', freshnessStatus: 'fresh', checkedAt: '2026-10-25T18:00:00Z',
  events: [
    { id: 'ranch-1', venueSlug: 'austin-pickle-ranch', name: 'Open Play: Level 2', startsAt: '2026-10-26T00:00:00Z', endsAt: '2026-10-26T02:00:00Z', price: 12, indoor: null, skillLabel: 'Intermediate', bookingUrl: 'https://austinpickleranch.podplay.app/community/events/00000000-0000-0000-0000-000000000001', preview: false },
    { id: 'east-1', venueSlug: 'eastside-paddle-club', name: 'Open Play: 4.0+ DUPR', startsAt: '2026-10-27T14:00:00Z', endsAt: '2026-10-27T16:00:00Z', price: 18, indoor: true, skillLabel: '4.0+', bookingUrl: 'https://espc.podplay.app/community/events/00000000-0000-0000-0000-000000000002', preview: false },
  ],
} };
export const holyId = '00000000-0000-0000-0000-000000000003';
export const holyListing = { eventId: holyId, type: 'OpenPlay', name: 'Open Play', open: true, startTime: '$D2026-10-25T14:00:00Z', endTime: '$D2026-10-25T16:00:00Z' };
export const holyHome = [
  { events: { events: [] }, eventsParams: { eventTypes: ['SpaceBooking'] } },
  { events: { events: [holyListing] }, eventsParams: { eventTypes: ['OpenPlay', 'Clinic'] } },
];
export const holyDetail = { event: {
  id: holyId, name: 'Open Play', club: { slug: 'holy-pickle' }, type: 'OpenPlay', privacy: 'public', open: true, deletedAt: null,
  metadata: { paymentData: { isPaid: true, rules: { NON_MEMBER: 10 } } },
  spaceAllocations: [{ startTime: holyListing.startTime, endTime: holyListing.endTime, deletedAt: null }],
} };

/**
 * OpenCourt's per-day court schedule (/api/club/<slug>/schedule?date=), times only. Four courts
 * open 7am–11pm in 30-minute slots. On Oct 25 the open play (holyId) holds every court 9–11am;
 * every day Court 2 has a member booking 1–2:30pm. The real response also names who booked; the
 * reader must not need that, so it is left out here.
 */
export function holySchedule(iso, { closed = false } = {}) {
  const court = (n) => {
    const slots = [];
    for (let m = 7 * 60; m < 23 * 60;) {
      if (iso === '2026-10-25' && m === 9 * 60) { slots.push({ reservationId: `r-open-${n}`, eventId: holyId, startTimeInMinutes: m, duration: 120 }); m += 120; continue; }
      if (n === 1 && m === 13 * 60) { slots.push({ reservationId: 'r-member', eventId: null, startTimeInMinutes: m, duration: 90 }); m += 90; continue; }
      slots.push({ reservationId: null, eventId: null, startTimeInMinutes: m, duration: 30, hasBookableDuration: true });
      m += 30;
    }
    return { courtId: `c${n}`, slots };
  };
  return { daysInRange: 1, remappedReservations: { [iso]: { courts: [0, 1, 2, 3].map(court), closedDay: closed, reservations: [], events: [] } } };
}
