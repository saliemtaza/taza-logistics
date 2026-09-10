import { useState } from 'react';
import CustomersPage from './pages/CustomersPage.jsx';
import DailyOrdersPage from './pages/DailyOrdersPage.jsx';
import RoutePlanPage from './pages/RoutePlanPage.jsx';
import FieldPage from './pages/FieldPage.jsx';
import FuelLogPage from './pages/FuelLogPage.jsx';
import ArchivePage from './pages/ArchivePage.jsx';
import CollectionsPage from './pages/CollectionsPage.jsx';
import VehiclesPage from './pages/VehiclesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

const TABS = {
  orders: { label: "Today's Orders", component: DailyOrdersPage },
  collections: { label: 'Collections', component: CollectionsPage },
  plan: { label: 'Route Plan', component: RoutePlanPage },
  field: { label: 'Field / Punch Clock', component: FieldPage },
  fuel: { label: 'Fuel Log', component: FuelLogPage },
  customers: { label: 'Customers', component: CustomersPage },
  vehicles: { label: 'Vehicles', component: VehiclesPage },
  archive: { label: 'History / Archive', component: ArchivePage },
  settings: { label: 'Settings', component: SettingsPage },
};

export default function App() {
  const [tab, setTab] = useState('orders');
  const Page = TABS[tab].component;

  return (
    <div>
      <header className="topbar">
        <h1>Taza Logistics</h1>
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
