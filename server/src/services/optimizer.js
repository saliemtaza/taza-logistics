import { haversineKm } from '../utils/haversine.js';

/**
 * Compass bearing (0-360°, 0 = north, clockwise) from the warehouse to a
 * point. Used below as a SOFT bias on vehicle direction — never a hard cut
 * (that was Session 3's mistake) — so a vehicle's chain of stops keeps a
 * genuine heading instead of zigzagging to whatever's nearest with no
 * memory of which way it's already travelling.
 */
function bearingFromWarehouse(warehouse, point) {
  const lat1 = (warehouse.lat * Math.PI) / 180;
  const lat2 = (point.lat * Math.PI) / 180;
  const dLng = ((point.lng - warehouse.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/** Smallest angle (0-180°) between two compass bearings. */
function angularDifference(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * How strongly a vehicle's direction-so-far discourages a candidate stop
 * that pulls it off-heading, relative to real distance. 0 = pure nearest-
 * neighbor (Session 4/5's zigzag). Higher = closer to a hard sector cut
 * (Session 3's stranded-orders problem). 1.5 favours a stop 30° off-heading
 * over one that's ~20% further away but dead-on-heading — tune this if the
 * fleet is still crossing itself too much (raise it) or leaving genuinely
 * nearby stops for a much later, worse vehicle (lower it).
 */
const DIRECTION_WEIGHT = 1.5;

/**
 * How far off a vehicle's established heading (from the warehouse) a
 * candidate stop may be and still count as "still my own direction/area"
 * for that vehicle. A vehicle exhausts everything within this tolerance
 * that still fits its caps before EVER branching into a stop outside it —
 * see the two-tier search below. Widen this if vehicles are still leaving
 * genuinely nearby stops for a worse-positioned later vehicle; narrow it
 * if a vehicle is still covering too many distinct areas in one route.
 */
const ANGLE_TOLERANCE_DEG = 40;

/**
 * How far (km, real distance from the vehicle's own current position) a
 * genuine Tier 2 pick — anchorBearing already set, Tier 1 came up
 * completely empty — may be from that vehicle before it's rejected instead
 * of accepted. Without this, a vehicle with spare capacity after its own
 * area is exhausted would happily accept an isolated, distant leftover
 * stop and drag the whole route out to reach it (live example: a single
 * stray stop turned a compact local route into a 46km/1h9m detour). Never
 * applies to a vehicle's first-ever stop (clusterCustomers.length === 0) —
 * a vehicle with nothing yet must accept whatever's next regardless of
 * distance, or it never starts at all. A rejected Tier 2 candidate isn't
 * lost — it just falls through to overflow, for deliberate manual
 * placement instead of an automatic, excessive detour.
 */
const MAX_TIER2_DETOUR_KM = 15;

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

/**
 * Builds a vehicle's stop order the same way stops get ASSIGNED to it in
 * the first place: real distance, softly biased (DIRECTION_WEIGHT) toward
 * staying on the heading set by the tour's own first stop. Plain nearest-
 * neighbor (the old version of this function) has no memory of which way
 * it's already travelling, so on a cluster that spans more than one real
 * area it can zigzag back and forth between them — 2-opt afterward only
 * fixes local crossings, it doesn't reliably undo that shape. This keeps a
 * vehicle's route grouped by area the same way its stop LIST is grouped,
 * so a manually-moved stop also gets this treatment (via costOutRoute ->
 * sequenceRoute), not just a fresh Generate.
 *
 * points[0] must be the warehouse; points[1..] the customers, in the same
 * order as matrix's rows/columns.
 */
function directionAwareTour(warehouse, points, matrix) {
  const n = matrix.length;
  const visited = new Array(n).fill(false);
  const tour = [0];
  visited[0] = true;

  let current = 0;
  let anchorBearing = null;

  for (let step = 1; step < n; step++) {
    let best = -1;
    let bestScore = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      const dist = matrix[current][j];
      let score = dist;
      if (anchorBearing != null) {
        const angleDiff = angularDifference(bearingFromWarehouse(warehouse, points[j]), anchorBearing);
        score = dist * (1 + DIRECTION_WEIGHT * (angleDiff / 180));
      }
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }
    tour.push(best);
    visited[best] = true;
    if (anchorBearing == null) anchorBearing = bearingFromWarehouse(warehouse, points[best]);
    current = best;
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
 * Or-opt: tries relocating each single stop (not warehouse endpoints) to
 * every other position in the tour, keeping any move that shortens it.
 * Complements 2-opt rather than replacing it — 2-opt can only reverse a
 * whole segment, which can't fix one stop stranded far from the cluster it
 * actually belongs to (exactly what showed up on real data: a single
 * Edenvale stop landing as the tour's very first pick, before any
 * direction bias exists to steer it, while its other Edenvale neighbours
 * end up grouped separately). Relocating just that one stop is what
 * segment-reversal structurally cannot do.
 */
function orOptImprove(tour, matrix, maxIterations = 100) {
  let best = [...tour];
  let bestLength = tourLength(best, matrix);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations += 1;
    for (let i = 1; i < best.length - 1; i++) { // never move the warehouse endpoints
      const stop = best[i];
      const withoutStop = [...best.slice(0, i), ...best.slice(i + 1)];
      for (let j = 1; j < withoutStop.length; j++) {
        if (j === i) continue; // same position, no-op
        const candidate = [...withoutStop.slice(0, j), stop, ...withoutStop.slice(j)];
        const candidateLength = tourLength(candidate, matrix);
        if (candidateLength < bestLength - 1e-6) {
          best = candidate;
          bestLength = candidateLength;
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
export function sequenceRoute(warehouse, customers) {
  if (customers.length === 0) return { orderedCustomers: [], legs: [], totalDistanceKm: 0 };

  const points = [warehouse, ...customers.map((c) => ({ lat: c.lat, lng: c.lng }))];
  const matrix = buildDistanceMatrix(points);

  let tour = directionAwareTour(warehouse, points, matrix);
  tour.push(0); // return to warehouse
  tour = twoOptImprove(tour, matrix);
  tour = orOptImprove(tour, matrix);
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
 * Rank vehicles smallest to largest by payload_limit_rand — vans have a
 * concrete Rand cap, trucks are null (unlimited), which naturally sorts
 * them last without needing to hardcode vehicle_type.
 */
function rankVehiclesBySize(vehicles) {
  return [...vehicles].sort((a, b) => {
    const capA = a.payload_limit_rand ?? Infinity;
    const capB = b.payload_limit_rand ?? Infinity;
    return capA - capB;
  });
}

/**
 * On a light day, all of today's stops may comfortably fit a single small
 * vehicle. Checks smallest-to-largest and returns the first vehicle whose
 * payload cap and the time window both fit the WHOLE day in one loop, or
 * null if nothing single-handedly fits (the normal case on a busy day,
 * where planRoutes falls through to the efficiency-ranked multi-vehicle
 * spread instead).
 */
function trySingleVehicleDay(orders, vehicles, warehouse, windowMinutes, safetyMarginPct) {
  const totalValue = orders.reduce((sum, o) => sum + o.value_rand, 0);
  // A pure cash collection loads nothing onto the vehicle — no warehouse
  // loading time applies. Only add it when at least one stop is an actual
  // delivery (goods going out).
  const hasDeliveries = orders.some((o) => o.value_rand > 0);
  for (const vehicle of rankVehiclesBySize(vehicles)) {
    if (vehicle.payload_limit_rand != null && totalValue > vehicle.payload_limit_rand) continue;
    if (vehicle.max_stops_per_day != null && orders.length > vehicle.max_stops_per_day) continue;
    const loadMinutes = hasDeliveries ? vehicle.avg_loading_minutes : 0;
    const { orderedCustomers, legs, totalDistanceKm } = sequenceRoute(warehouse, orders);
    const dwellTotal = orderedCustomers.reduce((sum, c) => sum + (c.avg_dwell_minutes ?? 10), 0);
    const driveMinutes = legs.reduce((sum, km) => sum + (km / vehicle.avg_speed_kmh) * 60, 0);
    const totalMinutes = loadMinutes + driveMinutes + dwellTotal;
    // Safety margin: the estimate below is only as good as the learned
    // averages feeding it, and real-world experience has shown it runs
    // optimistic. Inflate before comparing against the window so the
    // planner actually stops adding stops before a route would genuinely
    // overrun close time, not after.
    const paddedMinutes = totalMinutes * (1 + safetyMarginPct / 100);
    if (paddedMinutes <= windowMinutes) {
      return { vehicle, orderedCustomers, legs, totalDistanceKm, totalMinutes };
    }
  }
  return null;
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
    const fuelCostPerKm = price != null
      ? (v.fuel_consumption_l_per_100km / 100) * price
      : v.fuel_consumption_l_per_100km / 100; // proxy ranking if no price logged yet
    // True cost-per-km — fuel plus this vehicle's real maintenance/repair
    // burden (set on the Vehicles page from actual repair spend ÷ km
    // driven). An older, fuel-similar vehicle with heavy repair costs
    // should rank as genuinely more expensive to run, not just on fuel.
    const costPerKm = fuelCostPerKm + Number(v.maintenance_cost_per_km || 0);
    return { ...v, costPerKm };
  });
  ranked.sort((a, b) => a.costPerKm - b.costPerKm);
  ranked.forEach((v, i) => { v.efficiencyRank = i + 1; });
  return ranked;
}

/**
 * Greedy nearest-neighbor vehicle assignment: vehicles are filled in order
 * from CHEAPEST true cost (fuel + maintenance, see rankVehiclesByEfficiency)
 * to most expensive, each one absorbing stops — nearest-remaining-stop-first
 * — up to its own payload/stop/time limits before the next vehicle starts.
 * This means an expensive-to-run vehicle (heavy repair burden and/or poor
 * fuel) is only used at all once the cheaper vehicles are genuinely full —
 * it is not guaranteed a route every day regardless of real cost.
 */
export function planRoutes({ orders, vehicles, warehouse, openTime, closeTime, fuelPrices, safetyMarginPct = 20 }) {
  const windowMinutes = minutesBetween(openTime, closeTime);

  // Right-sizing check: see class comment on trySingleVehicleDay above.
  // Only kicks in when the whole day fits one vehicle; a normal 18-25
  // order day won't fit, so this falls straight through unchanged.
  const singleFit = trySingleVehicleDay(orders, vehicles, warehouse, windowMinutes, safetyMarginPct);
  if (singleFit) {
    const { vehicle, orderedCustomers, legs, totalDistanceKm, totalMinutes } = singleFit;
    const fuelPrice = fuelPrices[vehicle.fuel_type];
    const fuelLitres = (totalDistanceKm / 100) * vehicle.fuel_consumption_l_per_100km;
    const fuelCost = fuelPrice ? fuelLitres * fuelPrice : null;
    const plan = [{
      vehicle,
      stops: orderedCustomers,
      legDistancesKm: legs,
      totalDistanceKm,
      totalDurationMin: totalMinutes,
      fitsWindow: true,
      totalValueRand: orderedCustomers.reduce((s, c) => s + c.value_rand, 0),
      fuelLitres,
      fuelCost,
    }];
    return { plan, overflow: [], windowMinutes };
  }

  const rankedVehicles = rankVehiclesByEfficiency(vehicles, fuelPrices);
  // Fill order: the biggest-capacity vehicle (typically the truck — same
  // "unlimited/highest payload cap sorts last" size comparison used by
  // rankVehiclesBySize/trySingleVehicleDay above) goes FIRST, ahead of cost
  // ranking, so it's the one that lands on and absorbs the largest/densest
  // nearby cluster of stops in one trip — still bounded by its own
  // payload/stop-cap/time limits like every vehicle below, just given first
  // pick rather than last. Once it's done (or if there's no true "truck"
  // among today's vehicles), everything remaining fills cheapest-true-cost
  // (fuel + maintenance) first, so a fuel-efficient small van picks up the
  // longer/leftover driving rather than the truck grinding out extra km at
  // its worse cost-per-km.
  const bySize = rankVehiclesBySize(rankedVehicles);
  const primaryVehicle = bySize[bySize.length - 1];
  const restByEfficiency = rankedVehicles.filter((v) => v !== primaryVehicle);
  const vehicleQueue = [primaryVehicle, ...restByEfficiency];

  // Assign stops to vehicles by CHAINED nearest-neighbor: a single pointer
  // tracks "wherever the fleet currently is". The first vehicle starts the
  // pointer at the warehouse and repeatedly grabs whichever UNASSIGNED stop
  // is genuinely nearest (real distance, not angle) until it's full. The
  // next vehicle does NOT reset the pointer to the warehouse — it continues
  // from the previous vehicle's last stop, so it keeps working the same
  // area outward until that area is actually exhausted before drifting to
  // a new one. This fixes both prior approaches at once:
  //   - Session 2 (pure per-vehicle nearest-neighbor, each restarting from
  //     the warehouse): two vehicles' independent chains could both end up
  //     "nearest" to the same neighborhood -> same-area double-dispatch.
  //   - Session 3 (bearing sweep + fixed angular cut): a hard angle
  //     boundary has no relationship to real distance, so it could strand
  //     a whole dense cluster as unfit "overflow" while a vehicle with
  //     spare capacity sat pointed at a different angle -> dropped orders
  //     and under-filled vehicles even on a light day.
  // Because the pointer only advances to genuinely-nearest stops, a tight
  // cluster naturally keeps getting picked by whichever vehicle is active
  // when the fleet arrives there — including a big vehicle (e.g. the
  // truck) that lands there able to absorb far more of it than a small
  // van's cap would allow, rather than the cluster being pre-split by a
  // fixed line before capacity is even considered.
  //   - Live-data follow-up: pure distance alone still let a vehicle zigzag
  //     across the whole city once its local area thinned out (nothing
  //     stopping "nearest remaining" from being clear on the other side of
  //     Johannesburg). Selection below is now real distance softly biased
  //     by DIRECTION_WEIGHT to favour staying on the vehicle's established
  //     heading — see bearingFromWarehouse/angularDifference above.
  const unassigned = [...orders];
  const clusters = []; // { vehicle, customers: [] }
  let pointer = warehouse;

  // The single biggest order of the day (by delivery value) is deliberately
  // anchored to the biggest-capacity vehicle's FIRST stop below, rather
  // than left to the generic nearest/direction search to find its own way
  // to — that search can miss it entirely if enough better-scoring stops
  // fill the vehicle's stop-cap first, even while payload capacity for it
  // sits unused (the exact failure hit on real data: a R57,932 order
  // stranded in overflow while the vehicle carrying it had R64k of payload
  // room left, just not "in time" before hitting its stop cap). Anchoring
  // it first gives that vehicle's whole route a genuine starting point
  // built around the order it structurally has to carry, and everything
  // else — including the vehicle's own direction/heading — grows outward
  // from there instead of hoping to arrive in time.
  const biggestOrder = orders.reduce(
    (max, o) => (o.value_rand > (max?.value_rand ?? -Infinity) ? o : max),
    null
  );

  for (const vehicle of vehicleQueue) {
    if (unassigned.length === 0) break;

    const clusterCustomers = [];
    let clusterValue = 0;
    // currentPoint: inherited from the previous vehicle's endpoint (or the
    // warehouse for the first vehicle) — used ONLY to find/score the next
    // candidate, so selection keeps scanning outward from where the fleet
    // physically is, which is what avoids double-dispatch into the same
    // area. drivePoint: this vehicle's OWN real starting point, always the
    // warehouse, used for the actual time/fuel math on its first stop —
    // because that's genuinely where its day begins, regardless of where
    // some other vehicle's route happened to end. They're deliberately
    // different for the first pick, then converge (both become the
    // accepted stop) for every pick after. Conflating the two was a real
    // bug: a vehicle's first-stop time check was being measured from the
    // inherited pointer, so if that pointer was far from the remaining
    // stops, the vehicle could look too slow to take ANY of them and drop
    // out of the plan entirely — even though its true first leg (from the
    // warehouse) would have fit easily.
    let currentPoint = pointer;
    let drivePoint = warehouse;
    let runningMinutes = 0;
    let loadMinutesApplied = false;
    // Set once this vehicle accepts its first stop — its heading from the
    // warehouse, which subsequent picks for THIS vehicle are softly biased
    // toward staying close to (see DIRECTION_WEIGHT above).
    let anchorBearing = null;

    if (vehicle === primaryVehicle && biggestOrder && unassigned.includes(biggestOrder)) {
      const dist = haversineKm(drivePoint, biggestOrder); // first stop — always costed from the warehouse
      const legMinutes = (dist / vehicle.avg_speed_kmh) * 60;
      const dwellMinutes = biggestOrder.avg_dwell_minutes ?? 10;
      const returnMinutes = (haversineKm(biggestOrder, warehouse) / vehicle.avg_speed_kmh) * 60;
      const loadMinutes = vehicle.avg_loading_minutes; // first stop of the day
      const tentativeValue = biggestOrder.value_rand;
      const paddedTentativeMinutes = (loadMinutes + legMinutes + dwellMinutes + returnMinutes) * (1 + safetyMarginPct / 100);

      const fits = (vehicle.payload_limit_rand == null || tentativeValue <= vehicle.payload_limit_rand)
        && (vehicle.max_stops_per_day == null || vehicle.max_stops_per_day >= 1)
        && paddedTentativeMinutes <= windowMinutes;

      if (fits) {
        clusterCustomers.push(biggestOrder);
        clusterValue = tentativeValue;
        runningMinutes = loadMinutes + legMinutes + dwellMinutes;
        loadMinutesApplied = true;
        currentPoint = biggestOrder;
        drivePoint = biggestOrder;
        anchorBearing = bearingFromWarehouse(warehouse, biggestOrder);
        unassigned.splice(unassigned.indexOf(biggestOrder), 1);
      }
      // If it doesn't even fit the biggest vehicle, no vehicle in the fleet
      // can carry it — it falls through to the generic search below same
      // as anything else, and lands in overflow like any real shortfall.
    }

    while (unassigned.length > 0) {
      // Two-tier search for this vehicle's next stop. Tier 1: only
      // candidates within ANGLE_TOLERANCE_DEG of this vehicle's own
      // heading — pick the nearest of THOSE that still fits (payload/
      // stop-cap/time). Only if NOTHING on-heading fits does tier 2 run:
      // every remaining candidate, scored by real distance softly
      // penalized for direction (DIRECTION_WEIGHT), so a vehicle with
      // capacity left after its own area is genuinely exhausted still
      // picks up leftovers instead of stranding them — it just does so
      // only after tier 1 has nothing left, not interleaved with it. This
      // is what makes a vehicle exhaust one area/direction before ever
      // branching into another, instead of the softer single-pass
      // weighting still letting a close-but-wrong-direction stop outscore
      // a farther-but-on-heading one.
      let bestIdx = -1;
      let bestScore = Infinity;
      let bestDist = 0;
      let bestLegMinutes = 0;
      let bestDwellMinutes = 0;
      let bestLoadMinutes = 0;
      let bestTentativeValue = 0;

      const tiers = anchorBearing != null ? [true, false] : [false];
      for (const strict of tiers) {
        for (let i = 0; i < unassigned.length; i++) {
          const candidate = unassigned[i];

          if (strict) {
            const headingDiff = angularDifference(bearingFromWarehouse(warehouse, candidate), anchorBearing);
            if (headingDiff > ANGLE_TOLERANCE_DEG) continue; // not this vehicle's direction yet — try tier 2 only if tier 1 comes up empty
          }

          // Scoring/selection distance: from currentPoint (the inherited
          // scan position) — keeps the "which area is next" search
          // continuous across vehicles. Time/fuel distance: from
          // drivePoint (this vehicle's real position) — always the
          // warehouse until this vehicle has actually accepted a stop.
          const dist = haversineKm(currentPoint, candidate);
          const driveDist = haversineKm(drivePoint, candidate);

          // Tier 2 only (strict === false, anchorBearing already set) and
          // not this vehicle's very first stop — see MAX_TIER2_DETOUR_KM.
          if (!strict && anchorBearing != null && clusterCustomers.length > 0 && driveDist > MAX_TIER2_DETOUR_KM) {
            continue;
          }

          const legMinutes = (driveDist / vehicle.avg_speed_kmh) * 60;
          const dwellMinutes = candidate.avg_dwell_minutes ?? 10;
          const returnMinutes = (haversineKm(candidate, warehouse) / vehicle.avg_speed_kmh) * 60;
          const loadMinutes = loadMinutesApplied ? 0 : vehicle.avg_loading_minutes;
          const tentativeValue = clusterValue + candidate.value_rand;
          const tentativeMinutes = runningMinutes + loadMinutes + legMinutes + dwellMinutes + returnMinutes;
          const paddedTentativeMinutes = tentativeMinutes * (1 + safetyMarginPct / 100);

          const overPayload = vehicle.payload_limit_rand != null && tentativeValue > vehicle.payload_limit_rand;
          const overStopCap = vehicle.max_stops_per_day != null && (clusterCustomers.length + 1) > vehicle.max_stops_per_day;
          const overTime = paddedTentativeMinutes > windowMinutes;
          if (overPayload || overStopCap || overTime) continue; // doesn't fit — try the next candidate, don't give up yet

          let score = dist;
          if (anchorBearing != null) {
            const angleDiff = angularDifference(bearingFromWarehouse(warehouse, candidate), anchorBearing);
            score = dist * (1 + DIRECTION_WEIGHT * (angleDiff / 180));
          }
          if (score < bestScore) {
            bestScore = score;
            bestIdx = i;
            bestDist = dist;
            bestLegMinutes = legMinutes;
            bestDwellMinutes = dwellMinutes;
            bestLoadMinutes = loadMinutes;
            bestTentativeValue = tentativeValue;
          }
        }
        if (bestIdx !== -1) break; // tier 1 found something that fits — never widen to tier 2 while that's true
      }

      if (bestIdx === -1) {
        // Nothing left fits this vehicle at all, by any cap — genuinely
        // done for the day, move on to the next vehicle.
        break;
      }

      const candidate = unassigned[bestIdx];
      clusterCustomers.push(candidate);
      if (anchorBearing == null) anchorBearing = bearingFromWarehouse(warehouse, candidate);
      clusterValue = bestTentativeValue;
      runningMinutes += bestLoadMinutes + bestLegMinutes + bestDwellMinutes;
      loadMinutesApplied = true;
      currentPoint = candidate;
      drivePoint = candidate;
      unassigned.splice(bestIdx, 1);
    }

    if (clusterCustomers.length > 0) {
      clusters.push({ vehicle, customers: clusterCustomers });
      pointer = currentPoint;
    }
  }
  const overflow = [...unassigned];

  // Sequence each vehicle's cluster into an optimised loop and cost it out.
  const plan = clusters.map(({ vehicle, customers }) =>
    costOutRoute(vehicle, warehouse, customers, fuelPrices, safetyMarginPct, windowMinutes)
  );

  return { plan, overflow, windowMinutes };
}

/**
 * Sequence one vehicle's stops and cost the route out (distance, duration,
 * payload value, fuel cost, whether it fits the day's time window). This is
 * the one place that math lives — planRoutes' per-vehicle output and
 * moveStop's re-costing of a changed route both call this, so they can
 * never quietly drift into two different formulas for the same numbers.
 */
function costOutRoute(vehicle, warehouse, customers, fuelPrices, safetyMarginPct, windowMinutes) {
  const { orderedCustomers, legs, totalDistanceKm } = sequenceRoute(warehouse, customers);
  const dwellTotal = orderedCustomers.reduce((sum, c) => sum + (c.avg_dwell_minutes ?? 10), 0);
  const driveMinutes = legs.reduce((sum, km) => sum + (km / vehicle.avg_speed_kmh) * 60, 0);
  // Pure cash-collection stops load nothing onto the vehicle — only
  // charge warehouse loading time if this route has an actual delivery.
  const hasDeliveries = orderedCustomers.some((c) => c.value_rand > 0);
  const totalMinutes = (hasDeliveries ? vehicle.avg_loading_minutes : 0) + driveMinutes + dwellTotal;

  const fuelPrice = fuelPrices[vehicle.fuel_type];
  const fuelLitres = (totalDistanceKm / 100) * vehicle.fuel_consumption_l_per_100km;
  const fuelCost = fuelPrice ? fuelLitres * fuelPrice : null;

  return {
    vehicle,
    stops: orderedCustomers,
    legDistancesKm: legs,
    totalDistanceKm,
    totalDurationMin: totalMinutes,
    fitsWindow: totalMinutes * (1 + safetyMarginPct / 100) <= windowMinutes,
    totalValueRand: orderedCustomers.reduce((s, c) => s + c.value_rand, 0),
    fuelLitres,
    fuelCost,
  };
}

/**
 * Move a single customer stop from one vehicle's route to another, and
 * re-cost both. Neither route is just appended-to — BOTH are fully
 * re-sequenced (sequenceRoute's nearest-neighbor + 2-opt), so the receiving
 * vehicle gets the stop inserted wherever it actually fits best in its
 * existing loop, and the losing vehicle's remaining stops re-optimise too,
 * since their old order was only optimal including the stop that just left.
 *
 * This is a deliberate manual override of the automatic assignment — e.g.
 * moving a collection onto a smaller, less efficient vehicle because the
 * cash owed justifies the detour even though the algorithm wouldn't have
 * put it there. So caps are intentionally NOT enforced here: the receiving
 * vehicle's real new numbers are always returned, plus a `warning` string
 * whenever it now exceeds its own payload/stop-cap/time budget — for the
 * caller to display, never to silently block the move.
 */
export function moveStop({ warehouse, fromRoute, toRoute, customerId, fuelPrices, safetyMarginPct = 20, windowMinutes }) {
  const movingCustomer = fromRoute.stops.find((c) => c.customer_id === customerId);
  if (!movingCustomer) {
    throw new Error(`Customer ${customerId} isn't on ${fromRoute.vehicle.name}'s route — it may have already moved.`);
  }

  const remainingFromStops = fromRoute.stops.filter((c) => c.customer_id !== customerId);
  const newToStops = [...toRoute.stops, movingCustomer];

  const updatedFromRoute = { ...fromRoute, ...costOutRoute(fromRoute.vehicle, warehouse, remainingFromStops, fuelPrices, safetyMarginPct, windowMinutes) };
  const updatedToRoute = { ...toRoute, ...costOutRoute(toRoute.vehicle, warehouse, newToStops, fuelPrices, safetyMarginPct, windowMinutes) };

  const warning = buildOverCapacityWarning(toRoute.vehicle, updatedToRoute);

  return { fromRoute: updatedFromRoute, toRoute: updatedToRoute, warning };
}

/**
 * Move an unassigned (overflow) order/collection straight onto a vehicle's
 * route. Same deliberate-manual-override philosophy as moveStop above —
 * caps are NOT enforced, the vehicle's real new numbers come back either
 * way, plus a `warning` string if it's now over its own payload/stop-cap/
 * time budget. There's no `fromRoute` here because the stop was never on
 * any trip yet — it came from today's overflow list, not another vehicle.
 */
export function moveOverflowStop({ warehouse, toRoute, stop, fuelPrices, safetyMarginPct = 20, windowMinutes }) {
  const newToStops = [...toRoute.stops, stop];
  const updatedToRoute = { ...toRoute, ...costOutRoute(toRoute.vehicle, warehouse, newToStops, fuelPrices, safetyMarginPct, windowMinutes) };

  const warning = buildOverCapacityWarning(toRoute.vehicle, updatedToRoute);

  return { toRoute: updatedToRoute, warning };
}

/** Shared by moveStop and moveOverflowStop so the "now over capacity"
 * wording/logic can't quietly drift apart between the two manual-move
 * paths. */
function buildOverCapacityWarning(vehicle, updatedRoute) {
  const overPayload = vehicle.payload_limit_rand != null && updatedRoute.totalValueRand > vehicle.payload_limit_rand;
  const overStopCap = vehicle.max_stops_per_day != null && updatedRoute.stops.length > vehicle.max_stops_per_day;
  const overTime = !updatedRoute.fitsWindow;
  if (!overPayload && !overStopCap && !overTime) return null;

  const reasons = [];
  if (overPayload) reasons.push(`payload R${updatedRoute.totalValueRand.toFixed(0)} is over its R${vehicle.payload_limit_rand} cap`);
  if (overStopCap) reasons.push(`${updatedRoute.stops.length} stops is over its ${vehicle.max_stops_per_day}-stop cap`);
  if (overTime) reasons.push(`${(updatedRoute.totalDurationMin / 60).toFixed(1)} hrs is over today's time window`);
  return `${vehicle.name} is now over capacity: ${reasons.join('; ')}.`;
}

export function minutesBetween(startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
