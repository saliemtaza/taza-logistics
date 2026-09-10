import { haversineKm } from '../utils/haversine.js';

/**
 * Build a full distance matrix (km, straight-line) for a set of points.
 * Straight-line is used for the search/optimisation phase so this runs
 * instantly and works even with no map API access. Real road distance is
 * fetched once, afterwards, only for the finalized route.
 */
function buildDistanceMatrix(points) {
  const n = points.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(points[i], points[j]);
      matrix[i][j] = d;
      matrix[j][i] = d;
    }
  }
  return matrix;
}

function nearestNeighborTour(matrix, startIndex) {
  const n = matrix.length;
  const visited = new Array(n).fill(false);
  const tour = [startIndex];
  visited[startIndex] = true;

  let current = startIndex;
  for (let step = 1; step < n; step++) {
    let nearest = -1;
    let nearestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && matrix[current][j] < nearestDist) {
        nearestDist = matrix[current][j];
        nearest = j;
      }
    }
    tour.push(nearest);
    visited[nearest] = true;
    current = nearest;
  }
  return tour;
}

function tourLength(tour, matrix) {
  let total = 0;
  for (let i = 0; i < tour.length - 1; i++) {
    total += matrix[tour[i]][tour[i + 1]];
  }
  return total;
}

/** Standard 2-opt local search improvement over a nearest-neighbour tour. */
function twoOptImprove(tour, matrix, maxIterations = 200) {
  let improved = true;
  let iterations = 0;
  let best = [...tour];

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations += 1;
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const a = best[i - 1], b = best[i], c = best[j], d = best[j + 1];
        const before = matrix[a][b] + matrix[c][d];
        const after = matrix[a][c] + matrix[b][d];
        if (after < before - 1e-6) {
          const reversed = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
          best = reversed;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Sequence one vehicle's stops into an optimised warehouse -> ... -> warehouse
 * loop. Returns ordered customer list + per-leg distances (km, straight-line).
 */
function sequenceRoute(warehouse, customers) {
  if (customers.length === 0) return { orderedCustomers: [], legs: [], totalDistanceKm: 0 };

  const points = [warehouse, ...customers.map((c) => ({ lat: c.lat, lng: c.lng }))];
  const matrix = buildDistanceMatrix(points);

  let tour = nearestNeighborTour(matrix, 0);
  tour.push(0); // return to warehouse
  tour = twoOptImprove(tour, matrix);
  // twoOptImprove preserves endpoints (index 0 fixed as start), re-close the loop:
  if (tour[tour.length - 1] !== 0) tour.push(0);

  const orderedCustomers = tour.slice(1, -1).map((idx) => customers[idx - 1]);
  const legs = [];
  for (let i = 0; i < tour.length - 1; i++) {
    legs.push(matrix[tour[i]][tour[i + 1]]);
  }
  const totalDistanceKm = legs.reduce((a, b) => a + b, 0);

  return { orderedCustomers, legs, totalDistanceKm };
}

/**
 * Rank vehicles by fuel cost efficiency (Rand per km), best (cheapest to
 * run) to worst. Falls back to L/100km alone if no fuel price is set yet
 * for that fuel type. Returns the same vehicles annotated with costPerKm
 * and efficiencyRank (1 = most efficient).
 */
export function rankVehiclesByEfficiency(vehicles, fuelPrices) {
  const ranked = vehicles.map((v) => {
    const price = fuelPrices[v.fuel_type];
    const costPerKm = price != null
      ? (v.fuel_consumption_l_per_100km / 100) * price
      : v.fuel_consumption_l_per_100km / 100; // proxy ranking if no price logged yet
    return { ...v, costPerKm };
  });
  ranked.sort((a, b) => a.costPerKm - b.costPerKm);
  ranked.forEach((v, i) => { v.efficiencyRank = i + 1; });
  return ranked;
}

/**
 * Distance-zoned, efficiency-ranked vehicle assignment: customers are
 * sorted by straight-line distance from the warehouse (closest first), and
 * vehicles are filled in order from LEAST efficient (highest Rand/km) to
 * MOST efficient. This deliberately sends the least fuel-efficient vehicle
 * on the shortest runs — where its higher consumption costs the least in
 * absolute terms — and reserves the most efficient vehicle for the longest
 * runs, where efficiency compounds and matters most. Each vehicle's Rand
 * payload cap and the day's time window are still hard constraints within
 * that ordering.
 */
export function planRoutes({ orders, vehicles, warehouse, openTime, closeTime, warehouseLoadMinutes, fuelPrices }) {
  const windowMinutes = minutesBetween(openTime, closeTime);

  const rankedVehicles = rankVehiclesByEfficiency(vehicles, fuelPrices);
  // Fill order: least efficient (highest cost/km) first, so it claims the
  // nearest customers; most efficient vehicle fills last, absorbing
  // whatever's left — typically the furthest-out orders.
  const vehicleQueue = [...rankedVehicles].sort((a, b) => b.costPerKm - a.costPerKm);

  const sorted = [...orders].sort(
    (a, b) => haversineKm(warehouse, a) - haversineKm(warehouse, b)
  );

  const clusters = []; // { vehicle, customers: [] }
  let vIndex = 0;
  let cluster = { vehicle: vehicleQueue[0], customers: [] };
  let clusterValue = 0;
  let lastPoint = warehouse;
  let runningMinutes = warehouseLoadMinutes;
  const overflow = [];

  for (const order of sorted) {
    const vehicle = vehicleQueue[vIndex];
    if (!vehicle) { overflow.push(order); continue; }

    const legKm = haversineKm(lastPoint, order);
    const legMinutes = (legKm / vehicle.avg_speed_kmh) * 60;
    const dwellMinutes = order.avg_dwell_minutes ?? 10;
    const returnLegKm = haversineKm(order, warehouse);
    const returnMinutes = (returnLegKm / vehicle.avg_speed_kmh) * 60;

    const tentativeValue = clusterValue + order.value_rand;
    const tentativeMinutes = runningMinutes + legMinutes + dwellMinutes + returnMinutes;

    const overPayload = vehicle.payload_limit_rand != null && tentativeValue > vehicle.payload_limit_rand;
    const overTime = tentativeMinutes > windowMinutes;

    if (overPayload || overTime) {
      // Close current cluster, move to the next (more efficient) vehicle.
      if (cluster.customers.length > 0) clusters.push(cluster);
      vIndex += 1;
      const nextVehicle = vehicleQueue[vIndex];
      if (!nextVehicle) { overflow.push(order); continue; }
      cluster = { vehicle: nextVehicle, customers: [order] };
      clusterValue = order.value_rand;
      lastPoint = order;
      runningMinutes = warehouseLoadMinutes + (haversineKm(warehouse, order) / nextVehicle.avg_speed_kmh) * 60 + dwellMinutes;
    } else {
      cluster.customers.push(order);
      clusterValue = tentativeValue;
      lastPoint = order;
      runningMinutes += legMinutes + dwellMinutes;
    }
  }
  if (cluster.customers.length > 0) clusters.push(cluster);

  // Sequence each vehicle's cluster into an optimised loop and cost it out.
  const plan = clusters.map(({ vehicle, customers }) => {    const { orderedCustomers, legs, totalDistanceKm } = sequenceRoute(warehouse, customers);
    const dwellTotal = orderedCustomers.reduce((sum, c) => sum + (c.avg_dwell_minutes ?? 10), 0);
    const driveMinutes = legs.reduce((sum, km) => sum + (km / vehicle.avg_speed_kmh) * 60, 0);
    const totalMinutes = warehouseLoadMinutes + driveMinutes + dwellTotal;

    const fuelPrice = fuelPrices[vehicle.fuel_type];
    const fuelLitres = (totalDistanceKm / 100) * vehicle.fuel_consumption_l_per_100km;
    const fuelCost = fuelPrice ? fuelLitres * fuelPrice : null;

    return {
      vehicle,
      stops: orderedCustomers,
      legDistancesKm: legs,
      totalDistanceKm,
      totalDurationMin: totalMinutes,
      fitsWindow: totalMinutes <= windowMinutes,
      totalValueRand: orderedCustomers.reduce((s, c) => s + c.value_rand, 0),
      fuelLitres,
      fuelCost,
    };
  });

  return { plan, overflow, windowMinutes };
}

function minutesBetween(startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
