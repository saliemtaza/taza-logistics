import { APP_VERSION, CHANGELOG } from '../version.js';

// Short, plain-language explanation of what each tab is for. Keep this in
// sync with TABS in App.jsx whenever a tab is added, renamed or removed.
const SECTIONS = [
  { tab: "Today's Orders", text: "Bring in the day's delivery orders — either upload the export from the invoicing system, or tick them in manually — before generating a route plan." },
  { tab: 'Collections', text: 'Cash collections owed by customers, tracked separately from delivery orders. A customer can have a collection due with no delivery that day; when they have both, it merges into one stop on the route.' },
  { tab: 'Route Plan', text: "Pick which vehicles are available today, generate the route plan, and adjust it: move stops between vehicles, move overflow orders that couldn't fit onto a vehicle, and print loading sheets." },
  { tab: 'Loading', text: 'Loading-order reference for what goes on each vehicle and in what sequence, matching the printed loading sheets.' },
  { tab: 'Field / Punch Clock', text: 'Where drivers log Left Warehouse, arrival and departure at each stop, and Back at Warehouse — used to track trip time and feed the fuel/time learning model.' },
  { tab: 'Fuel Log', text: 'Record each fill-up (Rand paid, litres, odometer reading) per vehicle — this is how real fuel consumption is learned instead of relying on staff estimates.' },
  { tab: 'Customers', text: 'The customer database — addresses, geocoding status, and search/select, used to build daily orders and collections.' },
  { tab: 'Vehicles', text: "Fleet setup — payload and stop caps, cost-per-km, and each vehicle's efficiency ranking." },
  { tab: 'History / Archive', text: "Past days' plans and activity, once that view is built out." },
  { tab: 'Settings', text: 'Warehouse address, operating hours, fuel prices, and other day-to-day settings the route plan depends on.' },
];

export default function HelpPage() {
  return (
    <div className="page">
      <h2>Help &amp; Guide</h2>
      <p className="hint">Taza Logistics v{APP_VERSION}</p>

      <section className="card">
        <h3>What each tab does</h3>
        <dl>
          {SECTIONS.map((s) => (
            <div key={s.tab} style={{ marginBottom: '1em' }}>
              <dt style={{ fontWeight: 'bold' }}>{s.tab}</dt>
              <dd style={{ margin: 0 }}>{s.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card">
        <h3>What's changed</h3>
        <ul>
          {CHANGELOG.map((c) => (
            <li key={c.version}>
              <strong>v{c.version}</strong> — {c.date}: {c.notes}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
