import { useState } from 'react';
import CustomersPage from './pages/CustomersPage.jsx';
import DailyOrdersPage from './pages/DailyOrdersPage.jsx';
import RoutePlanPage from './pages/RoutePlanPage.jsx';
import LoadingPage from './pages/LoadingPage.jsx';
import FieldPage from './pages/FieldPage.jsx';
import FuelLogPage from './pages/FuelLogPage.jsx';
import ArchivePage from './pages/ArchivePage.jsx';
import CollectionsPage from './pages/CollectionsPage.jsx';
import VehiclesPage from './pages/VehiclesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import HelpPage from './pages/HelpPage.jsx';
import { APP_VERSION } from './version.js';

const TABS = {
  orders: { label: "Today's Orders", component: DailyOrdersPage },
  collections: { label: 'Collections', component: CollectionsPage },
  plan: { label: 'Route Plan', component: RoutePlanPage },
  loading: { label: 'Loading', component: LoadingPage },
  field: { label: 'Field / Punch Clock', component: FieldPage },
  fuel: { label: 'Fuel Log', component: FuelLogPage },
  customers: { label: 'Customers', component: CustomersPage },
  vehicles: { label: 'Vehicles', component: VehiclesPage },
  archive: { label: 'History / Archive', component: ArchivePage },
  settings: { label: 'Settings', component: SettingsPage },
  help: { label: 'Help', component: HelpPage },
};

export default function App() {
  const [tab, setTab] = useState('orders');
  const Page = TABS[tab].component;

  return (
    <div>
      <header className="topbar">
        <h1>Taza Logistics <span className="hint" style={{ fontSize: '0.6em', fontWeight: 'normal' }}>v{APP_VERSION}</span></h1>
        <nav>
          {Object.entries(TABS).map(([key, { label }]) => (
            <button key={key} className={key === tab ? 'active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <Page />
      </main>
    </div>
  );
}
