// Bumped by hand alongside real, delivered changes — not tied to a build
// tool or package.json. Add a line here whenever we ship something worth
// a driver or Saliem noticing; APP_VERSION is shown in the header and on
// the Help tab, CHANGELOG powers the "what's changed" list there.
export const APP_VERSION = '1.1.0';

export const CHANGELOG = [
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
