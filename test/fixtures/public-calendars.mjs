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
