import { planApproach, houseDoor, pointInHouseInterior } from "./approach";
import { createWorld } from "./world";

function line(ok: boolean, name: string, detail: string): string {
  return `${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`;
}

export function runApproachTests(): string[] {
  const world = createWorld();
  const house = world.houses.find((item) => item.id === "casita");
  if (!house) {
    return ["FAIL  casita — missing house"];
  }
  const door = houseDoor(house);
  const rng = () => 0.5;
  const front = planApproach(world, door.x + door.nx * 80, door.y + door.ny * 80, 146, 100, rng);
  const left = planApproach(world, house.x - 60, house.y + house.h * 0.5, 146, 100, rng);
  const right = planApproach(world, house.x + house.w + 60, house.y + house.h * 0.5, 146, 100, rng);
  const behind = planApproach(world, house.x + house.w * 0.5, house.y - 50, 146, 100, rng);
  const inside = planApproach(world, 146, 110, 146, 100, rng);
  const open = planApproach(world, 80, 80, 340, 280, rng);
  const crowd = [];
  for (let i = 0; i < 6; i++) {
    crowd.push(planApproach(world, 200 + i * 8, 300, 146, 100, () => (i + 1) / 8));
  }

  return [
    line(door.ny > 0.4 && door.x > 110 && door.x < 170, "puerta casita", `door=${door.x.toFixed(0)},${door.y.toFixed(0)} n=${door.nx},${door.ny}`),
    line(front.some((s) => s.id.endsWith("door-out")) && front.some((s) => s.id.endsWith("door-in")), "frente", front.map((s) => s.id).join(">")),
    line(left.some((s) => s.id.includes("door")), "izquierda", left.map((s) => s.id).join(">")),
    line(right.some((s) => s.id.includes("door")), "derecha", right.map((s) => s.id).join(">")),
    line(behind.some((s) => /nw|ne|sw|se/.test(s.id)) && behind.some((s) => s.id.includes("door")), "detrás", behind.map((s) => s.id).join(">")),
    line(inside.length === 0, "ya dentro", `stops=${inside.length}`),
    line(open.length === 0, "sin puerta", `stops=${open.length}`),
    line(crowd.every((r) => r.some((s) => s.id.includes("door"))), "6 NPCs", crowd.map((r) => r.length).join(",")),
    line(pointInHouseInterior(146, 100, house), "interior check", "146,100"),
  ];
}

const node = (globalThis as { process?: { argv?: string[]; exit?: (code: number) => void } }).process;
const invoked = node?.argv?.[1] ?? "";
if (invoked.replace(/\\/g, "/").endsWith("approachTest.ts")) {
  const failed = runApproachTests().some((row) => {
    console.log(row);
    return row.startsWith("FAIL");
  });
  console.log(failed ? "RESULTADO: FAIL" : "RESULTADO: OK");
  node?.exit?.(failed ? 1 : 0);
}
