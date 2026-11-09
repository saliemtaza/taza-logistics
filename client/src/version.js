// Bumped by hand alongside real, delivered changes — not tied to a build
// tool or package.json. Add a line here whenever we ship something worth
// a driver or Saliem noticing; APP_VERSION is shown in the header and on
// the Help tab, CHANGELOG powers the "what's changed" list there.
export const APP_VERSION = '1.5.4';

export const CHANGELOG = [
  {
    version: '1.5.4',
    date: '2026-11-09',
    notes: 'Late orders now go into the "Not placed yet" list (previously "Could not fit today") for you to allocate to a vehicle yourself with move-to or drag, instead of being placed automatically; the late-order slip is gone. Once placed, "Print all loading sheets" (now shown whenever at least one vehicle has a route) reprints every vehicle\'s sheet, with late orders starred. A late order for a customer already on a vehicle still adds to their existing stop.',
  },
  {
    version: '1.5.3',
    date: '2026-11-09',
    notes: 'Route Plan: "Add a late order" for an order that arrives after the plan was generated or the loading sheets printed. Pick the customer and the value and either a vehicle or "best fit" (the vehicle it adds the fewest extra km to, preferring one that stays within its payload, stop and time limits). The stop slots into that route at the cheapest position and nothing else is re-planned; if the customer is already on a vehicle, the value is added to their existing stop. A vehicle that has already left the warehouse is never changed. Late orders are starred on the route and on reprinted loading sheets, and a one-page late-order slip prints for the warehouse showing the vehicle, delivery stop, load position and the vehicle\'s new total.',
  },
  {
    version: '1.5.2',
    date: '2026-11-02',
    notes: 'Loading sheets (single vehicle and the combined sheet) now show each order\'s value and a running total down the load order, with the vehicle\'s total order value on the last line. Cash-collection-only stops show as such and add R0.',
  },
  {
    version: '1.5.1',
    date: '2026-11-02',
    notes: 'Route Plan: new "Reverse route" button on each vehicle flips that vehicle\'s stop order (last stop becomes first) without touching the other vehicles — press it again to flip back. Distance, time, fuel cost, the back-by estimate and the Maps links all update to the reversed order. Reordering, Optimise order and Reverse are now refused for a vehicle that has already left the warehouse, because rewriting its stops would have wiped the driver\'s arrived/left punches.',
  },
  {
    version: '1.5.0',
    date: '2026-11-02',
    notes: 'New Dashboard tab (printable, refreshes every minute): per vehicle and for the whole fleet over any date range, calculated figures from the route plans (trips, stops, delivery value, km, hours, fuel, maintenance, running cost, cost per km and per stop) beside the actuals from field punches (trips and stops completed, time left-to-back, trips back after 16:30) and fuel fill-ups (odometer km, litres, fuel cost, l/100 km), with the variance between them. Actual columns show a dash until that data exists. Service tracker: set a service interval per vehicle, record each service, and the dashboard counts km since then (odometer when available, otherwise calculated km), warns when a vehicle is within its warning distance and flags it overdue, with an estimate of working days left. New vehicle_services table and two new vehicle columns (run dashboard-migration.sql).',
  },
  {
    version: '1.4.11',
    date: '2026-10-30',
    notes: 'Route Plan: each vehicle now has a "View route on Maps" button that opens its stops in Google Maps as driving directions, starting and ending at the warehouse, in the order currently shown (so it reflects any moves or reordering). Google Maps only accepts 9 stops in between per link, so a longer route gets several buttons ("Maps 1 of 2 (stops 1-10)", "Maps 2 of 2 (stops 11-13 + back)"), each picking up where the last ended. Uses the stored pins, not the address text. A stop with no location on file is left off and flagged.',
  },
  {
    version: '1.4.10',
    date: '2026-10-27',
    notes: 'Route sequencing grouping fix: the 1.4.9 tie-break could only try one change at a time, so it could not regroup a route like Malvern/Kensington/Germiston where several stops have to move together. It now searches combinations of moves (same stops in, same order out every time) and still only accepts an order within about half a kilometre (or 1.5%) of the shortest. On the 27 Oct Steed route this keeps the Malvern/Kensington stops together and the Germiston stops together, for 0.6 km extra.',
  },
  {
    version: '1.4.9',
    date: '2026-10-27',
    notes: 'Route sequencing now prefers finishing an area before leaving it. Two stop orders that are almost the same length used to be a coin toss, so a route could visit one stop in an area early and come back to its neighbour at the end (e.g. Kensington split in two). A small tie-break now picks the grouped order whenever it costs no more than about half a kilometre (or 1.5% of the route, whichever is larger). Applies to Generate and "Optimise order"; manual moves and drag-reorders are unchanged.',
  },
  {
    version: '1.4.8',
    date: '2026-10-27',
    notes: 'Route Plan: every available vehicle is now a valid place to move stops to, even one the planner gave no stops (previously the "move to" picker only appeared when two or more vehicles had routes, so a day where everything landed on the Isuzu offered no way to move stops onto the Steed or Sailor). A vehicle with no stops shows as "no stops yet" and can also be dragged onto; its trip is created when the first stop lands on it. Each vehicle now shows its estimated return time, with a warning (never a limit) when it is estimated to be back after 16:30.',
  },
  {
    version: '1.4.7',
    date: '2026-10-27',
    notes: 'Geocoding is now confined to Gauteng (biased to Johannesburg), and the province is added to addresses that lack one. Addresses with only a suburb name used to be matched anywhere in the world — 62 customers had pins in places like France, Perth and Cape Town. An address Google cannot place in Gauteng now shows as a failed geocode instead of a silently wrong pin. Coordinates supplied in a customer CSV that fall outside Gauteng are ignored and the address is geocoded instead.',
  },
  {
    version: '1.4.6',
    date: '2026-10-27',
    notes: 'Cash collections no longer need an amount — a collection is there to fit the customer into the route, so the Collections page now just ticks customers (no value field), and a collections CSV only needs a code or name. Stops with a collection but no amount show "cash collection" on the Route Plan and "Collect cash" on the driver screen. Collections list also shows the "not geocoded" and "not in Gauteng" flags next to customers.',
  },
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
