// Bumped by hand alongside real, delivered changes — not tied to a build
// tool or package.json. Add a line here whenever we ship something worth
// a driver or Saliem noticing; APP_VERSION is shown in the header and on
// the Help tab, CHANGELOG powers the "what's changed" list there.
export const APP_VERSION = '1.4.5';

export const CHANGELOG = [
  {
    version: '1.4.5',
    date: '2026-10-23',
    notes: 'Route planning: with two similar vans, the more efficient one now fills first and starts from the farthest remaining stop (e.g. the Kagiso/Azaadville cluster), picking up near-warehouse stops on the way back, instead of the less efficient van filling first and wandering out into the far area. A genuinely bigger vehicle (e.g. the Isuzu) still goes first as before. Stops the area rules would have dropped to "Could not fit today" are now placed on whichever route they add the least distance to, as long as payload, stop cap and time allow — with a warning showing the extra km — and only a real limit leaves a stop in overflow. Overflow stops now carry their address and location, so the "not in Gauteng" flag works there too.',
  },
  {
    version: '1.4.4',
    date: '2026-10-23',
    notes: 'Customers page: customers whose geocoded location is outside Gauteng now get their own "Outside Gauteng" list at the top (with Retry), and a flag next to the address in the full customer list — so a wrong-city geocode is spotted at the source instead of only once it shows up on a route.',
  },
  {
    version: '1.4.3',
    date: '2026-10-23',
    notes: 'Route Plan: moving a stop onto a vehicle now slots it in where it adds the least distance and leaves the rest of that route\'s order alone (and the vehicle it came from just closes the gap), instead of re-sequencing both routes from scratch and undoing hand-arranged order. New "Optimise order" button per vehicle re-sequences that one route automatically when you do want that. Addresses whose coordinates fall outside Gauteng now show a "not in Gauteng" flag on Today\'s Orders and the Route Plan, to catch bad geocodes (e.g. a Newlands address that landed in Cape Town).',
  },
  {
    version: '1.4.2',
    date: '2026-10-14',
    notes: 'Route Plan: stops can now be dragged to reorder within a vehicle, or dragged onto another vehicle to move them there — faster than the existing checkbox + "move to" picker, which still works for moving several stops at once. New backend endpoint wires up the within-route reordering built last session but never connected to a screen.',
  },
  {
    version: '1.4.1',
    date: '2026-09-27',
    notes: 'Fixed two bugs from the 24 Sep upload: (1) an uploaded order matched to a customer via "Not recognised" now saves immediately instead of only on the next Save, and unmatched rows now survive a refresh instead of vanishing; a blank/totals row from a Zoho export is no longer reported as an unrecognised customer. (2) Stops close to the warehouse (e.g. Newclare/Newlands) were being rejected by a vehicle already working a nearby area, on the grounds of "wrong direction" — direction is meaningless that close to the warehouse. They\'re now placed on whichever vehicle has room left, instead of getting stranded onto an unrelated route.',
  },
  {
    version: '1.4.0',
    date: '2026-09-23',
    notes: 'Backend groundwork for manually reordering stops within a vehicle\'s route without the optimizer re-sequencing them back — not yet wired to a screen, so nothing changes for drivers or dispatch yet.',
  },
  {
    version: '1.3.1',
    date: '2026-09-23',
    notes: 'Fixed a single stop occasionally getting stranded away from its natural cluster (e.g. one Edenvale stop visited alone while the rest of Edenvale gets grouped separately) — the route-sequencing step can now relocate a single stop, not just reverse whole segments.',
  },
  {
    version: '1.3.0',
    date: '2026-09-23',
    notes: 'Fixed routes zigzagging between areas within a single vehicle\'s stop order (e.g. jumping back and forth between two suburbs). A vehicle picking up an isolated, distant leftover stop now drops it to overflow for manual placement instead of dragging the whole route into a large detour.',
  },
  {
    version: '1.2.0',
    date: '2026-09-23',
    notes: 'Orders from an uploaded CSV that don\'t match any customer no longer vanish — they now show in a "Not recognised" list on Today\'s Orders, where they can be matched to the correct customer and placed, or dismissed.',
  },
  {
    version: '1.1.1',
    date: '2026-09-23',
    notes: 'Fixed: a customer address correction (via CSV re-upload) is no longer silently excluded from geocoding forever if that customer had previously failed geocoding.',
  },
  {
    version: '1.1.0',
    date: '2026-09-23',
    notes: 'Driver/cash collector/crew picker added to Field/Punch Clock, required before a vehicle can leave — carries through into the daily report. Fixed a bug where a permanently-bad address could make "Geocode all pending" retry forever and run up API cost. "Left customer" now auto-opens Maps navigation straight to the next stop instead of leaving the driver to find it manually.',
  },
  {
    version: '1.0.0',
    date: '2026-09-17',
    notes: 'Version tracking and Help tab added. Overflow ("could not fit today") orders can now be moved onto a vehicle the same way regular stops can. Combined loading sheets print on one page instead of one page per vehicle.',
  },
];
