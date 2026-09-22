import { query, queryOne } from '../db/index.js';

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Geocoding runs in small batches rather than "all pending customers in one
// request" — a single request geocoding hundreds of customers is fragile
// (one slow call or network blip fails the whole batch with no progress
// saved) and, on a serverless host, risks hitting the function's execution
// time limit outright. 40 customers at roughly 250-350ms per Google call
// comfortably finishes in a few seconds either way.
const BATCH_SIZE = 40;

/**
 * Geocode a single address via Google Geocoding API.
 * Only ever called for customers with no cached lat/lng, or whose address
 * changed — keeps API usage to roughly one call per customer, ever.
 */
async function geocodeAddress(address) {
  if (!API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set');
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Geocoding failed for "${address}": ${data.status}`);
  }
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}

/**
 * Geocode up to BATCH_SIZE customers missing coordinates. Returns a summary
 * of successes/failures plus how many are still pending after this batch,
 * so the caller (a CSV import, or the client polling a "geocode more"
 * button) knows whether to call again.
 */
export async function geocodeMissingCustomers() {
  // geocode_failed_at IS NULL excludes addresses that have already failed —
  // without this, a single permanently-bad address (Google can never
  // resolve it) stays "pending" forever, and the client's retry-until-done
  // loop (CustomersPage.jsx) spins on it indefinitely. A failed address
  // only comes back into play via an explicit manual Retry (regeocodeCustomer
  // below), which clears geocode_failed_at.
  const pending = await query(
    'SELECT id, address FROM customers WHERE (lat IS NULL OR lng IS NULL) AND geocode_failed_at IS NULL LIMIT $1',
    [BATCH_SIZE]
  );

  const results = { succeeded: 0, failed: [] };

  for (const customer of pending) {
    try {
      const { lat, lng } = await geocodeAddress(customer.address);
      await query(
        'UPDATE customers SET lat = $1, lng = $2, geocoded_at = $3, geocode_failed_at = NULL WHERE id = $4',
        [lat, lng, new Date().toISOString(), customer.id]
      );
      results.succeeded += 1;
    } catch (err) {
      await query('UPDATE customers SET geocode_failed_at = $1 WHERE id = $2', [new Date().toISOString(), customer.id]);
      results.failed.push({ id: customer.id, address: customer.address, error: err.message });
    }
    // Small delay to stay well clear of rate limits — irrelevant at this volume, but polite.
    await new Promise((r) => setTimeout(r, 50));
  }

  // Only counts rows still eligible for auto-batching — a failed row just
  // marked above is deliberately excluded, so the client's loop actually
  // terminates instead of retrying the same dead address forever.
  const [{ count }] = await query(
    'SELECT COUNT(*) AS count FROM customers WHERE (lat IS NULL OR lng IS NULL) AND geocode_failed_at IS NULL'
  );
  results.stillPending = parseInt(count, 10);

  return results;
}

/**
 * Geocode the warehouse address and store lat/lng directly into settings.
 * Called once whenever the warehouse address is set/changed.
 */
export async function geocodeWarehouseAddress(address) {
  const { lat, lng } = await geocodeAddress(address);
  await query(
    "INSERT INTO settings (key, value) VALUES ('warehouse_lat', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [String(lat)]
  );
  await query(
    "INSERT INTO settings (key, value) VALUES ('warehouse_lng', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [String(lng)]
  );
  return { lat, lng };
}

/**
 * Re-geocode a single customer explicitly (e.g. after an address edit).
 */
export async function regeocodeCustomer(customerId) {
  const customer = await queryOne('SELECT id, address FROM customers WHERE id = $1', [customerId]);
  if (!customer) throw new Error('Customer not found');

  try {
    const { lat, lng } = await geocodeAddress(customer.address);
    await query(
      'UPDATE customers SET lat = $1, lng = $2, geocoded_at = $3, geocode_failed_at = NULL WHERE id = $4',
      [lat, lng, new Date().toISOString(), customerId]
    );
    return { lat, lng };
  } catch (err) {
    await query('UPDATE customers SET geocode_failed_at = $1 WHERE id = $2', [new Date().toISOString(), customerId]);
    throw err;
  }
}

/**
 * Get real road distance/duration for a finalized ordered list of stops
 * (warehouse -> stop1 -> stop2 -> ... -> warehouse), via the Routes API.
 * Called ONCE per finalized trip, not during optimisation search.
 */
export async function getRoadRoute(orderedPoints) {
  if (!API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set');
  }
  if (orderedPoints.length < 2) {
    return { legs: [], totalDistanceKm: 0, totalDurationMin: 0 };
  }

  const origin = orderedPoints[0];
  const destination = orderedPoints[orderedPoints.length - 1];
  const waypoints = orderedPoints.slice(1, -1);

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    intermediates: waypoints.map((p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })),
    travelMode: 'DRIVE',
    optimizeWaypointOrder: false, // we already sequenced the route ourselves
  };

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!data.routes?.length) {
    throw new Error(`Routes API failed: ${JSON.stringify(data)}`);
  }
  const route = data.routes[0];
  const legs = route.legs.map((leg) => ({
    distanceKm: leg.distanceMeters / 1000,
    durationMin: parseInt(leg.duration.replace('s', ''), 10) / 60,
  }));

  return {
    legs,
    totalDistanceKm: route.distanceMeters / 1000,
    totalDurationMin: parseInt(route.duration.replace('s', ''), 10) / 60,
  };
}
