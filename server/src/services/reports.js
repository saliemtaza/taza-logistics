import { query, queryOne } from '../db/index.js';

// Rebuilds the full daily summary for a date from actual trip/stop data and
// upserts it. Called after every 'Back at Warehouse' punch — cheap (one
// date's worth of trips) and safe to re-run mid-day as more trips complete,
// since it always recomputes from scratch rather than incrementing.
export async function generateDailyReport(date) {
  const trips = await query(`
    SELECT t.*, v.name AS vehicle_name
    FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.trip_date = $1
  `, [date]);

  if (trips.length === 0) return;

  const stopsByTrip = await Promise.all(trips.map((t) =>
    query('SELECT * FROM trip_stops WHERE trip_id = $1', [t.id])
  ));

  let totalStops = 0, totalKm = 0, totalDeliveryValue = 0, totalCollectionValue = 0;
  let totalFuelLitres = 0, totalFuelCost = 0;
  let deliveryCount = 0, collectionCount = 0;
  const overBudget = [];
  const vehicleSummaries = [];

  trips.forEach((trip, i) => {
    const stops = stopsByTrip[i];
    totalStops += stops.length;
    totalKm += trip.planned_distance_km || 0;
    totalFuelLitres += trip.planned_fuel_litres || 0;
    totalFuelCost += trip.planned_fuel_cost_rand || 0;

    let vDelivery = 0, vCollection = 0;
    for (const s of stops) {
      if (s.delivery_value_rand > 0) { vDelivery += Number(s.delivery_value_rand); deliveryCount += 1; }
      if (s.collection_amount_rand > 0) { vCollection += Number(s.collection_amount_rand); collectionCount += 1; }
    }
    totalDeliveryValue += vDelivery;
    totalCollectionValue += vCollection;

    const actualMinutes = trip.left_warehouse_at && trip.back_at_warehouse_at
      ? (new Date(trip.back_at_warehouse_at) - new Date(trip.left_warehouse_at)) / 60000
      : null;

    vehicleSummaries.push({
      vehicle_name: trip.vehicle_name,
      stops: stops.length,
      distance_km: trip.planned_distance_km,
      planned_minutes: trip.planned_duration_min,
      actual_minutes: actualMinutes,
      delivery_value_rand: vDelivery,
      collection_value_rand: vCollection,
      status: trip.status,
    });

    if (trip.back_at_warehouse_at) {
      const closeCutoff = new Date(`${date}T16:30:00`); // display-only flag; actual close_time setting isn't loaded here
      if (new Date(trip.back_at_warehouse_at) > closeCutoff) {
        overBudget.push(trip.vehicle_name);
      }
    }
  });

  const data = {
    report_date: date,
    vehicles_run: trips.length,
    total_stops: totalStops,
    total_km: Math.round(totalKm * 10) / 10,
    delivery_count: deliveryCount,
    collection_count: collectionCount,
    total_delivery_value_rand: Math.round(totalDeliveryValue),
    total_collection_value_rand: Math.round(totalCollectionValue),
    total_fuel_litres: Math.round(totalFuelLitres * 10) / 10,
    total_fuel_cost_rand: Math.round(totalFuelCost),
    vehicles_over_close_time: overBudget,
    vehicles: vehicleSummaries,
  };

  await query(
    `INSERT INTO daily_reports (report_date, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (report_date) DO UPDATE SET data = excluded.data, updated_at = now()`,
    [date, JSON.stringify(data)]
  );
}

// Collapses any daily_reports rows from months before the current one into
// a single monthly_reports row, then deletes those daily rows. Safe to call
// often (e.g. once per route-plan generation) — it's a no-op once nothing
// old remains. This is what keeps storage bounded indefinitely: the current
// and previous-in-progress month keep daily granularity, everything older
// compresses to one small row per month forever.
export async function rollupOldMonths() {
  const currentMonthStart = new Date();
  currentMonthStart.setDate(1);
  currentMonthStart.setHours(0, 0, 0, 0);
  const currentMonthStr = currentMonthStart.toISOString().slice(0, 10);

  const oldMonths = await query(`
    SELECT DISTINCT date_trunc('month', report_date)::date AS month
    FROM daily_reports
    WHERE report_date < $1
  `, [currentMonthStr]);

  for (const { month } of oldMonths) {
    const monthStr = month.toISOString ? month.toISOString().slice(0, 10) : month;
    const days = await query(
      'SELECT data FROM daily_reports WHERE date_trunc(\'month\', report_date) = $1',
      [monthStr]
    );
    if (days.length === 0) continue;

    const totals = days.reduce((acc, { data }) => {
      acc.days_active += 1;
      acc.total_stops += data.total_stops || 0;
      acc.total_km += data.total_km || 0;
      acc.delivery_count += data.delivery_count || 0;
      acc.collection_count += data.collection_count || 0;
      acc.total_delivery_value_rand += data.total_delivery_value_rand || 0;
      acc.total_collection_value_rand += data.total_collection_value_rand || 0;
      acc.total_fuel_litres += data.total_fuel_litres || 0;
      acc.total_fuel_cost_rand += data.total_fuel_cost_rand || 0;
      acc.over_close_time_incidents += (data.vehicles_over_close_time || []).length;
      return acc;
    }, {
      days_active: 0, total_stops: 0, total_km: 0, delivery_count: 0, collection_count: 0,
      total_delivery_value_rand: 0, total_collection_value_rand: 0,
      total_fuel_litres: 0, total_fuel_cost_rand: 0, over_close_time_incidents: 0,
    });
    totals.total_km = Math.round(totals.total_km * 10) / 10;
    totals.total_fuel_litres = Math.round(totals.total_fuel_litres * 10) / 10;

    await query(
      `INSERT INTO monthly_reports (report_month, data) VALUES ($1, $2)
       ON CONFLICT (report_month) DO UPDATE SET data = excluded.data`,
      [monthStr, JSON.stringify(totals)]
    );
    await query('DELETE FROM daily_reports WHERE date_trunc(\'month\', report_date) = $1', [monthStr]);
  }
}
