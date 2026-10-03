// Prints the length of the intended playthrough route in data/level.json.
// Run: npm run tool tools/level-route.ts
import { LevelQueries } from "./LevelQueries";

const level = LevelQueries.load();
const total = level.routeLength();
console.log(`Route: ${level.level.route.length} waypoints, ${total.toFixed(1)} m total`);
for (const [floor, length] of [...level.routeLengthByFloor()].sort((a, b) => b[0] - a[0])) {
  console.log(`  segments starting on Floor ${floor}: ${length.toFixed(1)} m`);
}
for (const point of level.level.route.filter((p) => p.label)) {
  console.log(`  - ${point.label} (Floor ${point.floor}, ${point.x}, ${point.z})`);
}
