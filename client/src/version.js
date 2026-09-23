// Bumped by hand alongside real, delivered changes — not tied to a build
// tool or package.json. Add a line here whenever we ship something worth
// a driver or Saliem noticing; APP_VERSION is shown in the header and on
// the Help tab, CHANGELOG powers the "what's changed" list there.
export const APP_VERSION = '1.3.0';

export const CHANGELOG = [
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
