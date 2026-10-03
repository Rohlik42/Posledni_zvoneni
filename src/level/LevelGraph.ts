import type { LevelLayout } from "./LevelLayout";
import type { Stair } from "./LevelTypes";

interface GraphNode {
  x: number;
  y: number;
  z: number;
}

interface Edge {
  to: number;
  length: number;
}

/**
 * Walking distances between rooms without a navmesh (that comes with phase 10): a graph of room spots, door centres
 * and stair ends. Inside a room every pair of its points is joined by a straight line (rooms are empty rectangles);
 * a stair is one edge as long as its flights and landing crossings. Locks are ignored.
 */
export class LevelGraph {
  private readonly nodes: GraphNode[] = [];
  private readonly edges: Edge[][] = [];
  private readonly roomNodes = new Map<string, number>();

  constructor(layout: LevelLayout) {
    const pointsInRoom = new Map<string, number[]>();
    const addToRoom = (room: string, node: number): void => {
      const list = pointsInRoom.get(room) ?? [];
      list.push(node);
      pointsInRoom.set(room, list);
    };
    for (const room of layout.level.rooms) {
      const spot = layout.freeSpot(room);
      const node = this.add({ x: spot.x, y: spot.y, z: spot.z });
      this.roomNodes.set(room.id, node);
      addToRoom(room.id, node);
    }
    for (const door of layout.level.doors) {
      const y = Math.max(...door.rooms.map((id) => layout.floorY(layout.room(id))));
      const node = this.add({ x: door.x, y, z: door.z });
      for (const room of door.rooms) addToRoom(room, node);
    }
    for (const stair of layout.level.stairs) {
      const first = stair.flights[0]!;
      const last = stair.flights[stair.flights.length - 1]!;
      const bottom = this.add({ x: first.from.x, y: first.y0, z: first.from.z });
      const top = this.add({ x: last.to.x, y: last.y1, z: last.to.z });
      this.link(bottom, top, LevelGraph.stairLength(stair));
      addToRoom(stair.bottomRoom, bottom);
      addToRoom(stair.topRoom, top);
    }
    for (const nodes of pointsInRoom.values()) {
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) this.link(nodes[i]!, nodes[j]!, this.distance(nodes[i]!, nodes[j]!));
    }
  }

  /** Shortest walking distance (m) between the free spots of two rooms, or −1 when there is no connection. */
  pathLength(fromRoom: string, toRoom: string): number {
    const from = this.roomNodes.get(fromRoom);
    const to = this.roomNodes.get(toRoom);
    if (from === undefined || to === undefined) return -1;
    const distance = new Array<number>(this.nodes.length).fill(Infinity);
    const done = new Array<boolean>(this.nodes.length).fill(false);
    distance[from] = 0;
    for (;;) {
      let current = -1;
      for (let i = 0; i < distance.length; i++) if (!done[i] && (current < 0 || distance[i]! < distance[current]!)) current = i;
      if (current < 0 || distance[current] === Infinity) return -1;
      if (current === to) return distance[to]!;
      done[current] = true;
      for (const edge of this.edges[current]!) distance[edge.to] = Math.min(distance[edge.to]!, distance[current]! + edge.length);
    }
  }

  /** Flight lengths (3D) plus the walk across each landing between consecutive flights. */
  static stairLength(stair: Stair): number {
    let length = 0;
    stair.flights.forEach((flight, i) => {
      length += Math.hypot(flight.to.x - flight.from.x, flight.y1 - flight.y0, flight.to.z - flight.from.z);
      const next = stair.flights[i + 1];
      if (next !== undefined) length += Math.hypot(next.from.x - flight.to.x, next.from.z - flight.to.z);
    });
    return length;
  }

  private add(node: GraphNode): number {
    this.nodes.push(node);
    this.edges.push([]);
    return this.nodes.length - 1;
  }

  private link(a: number, b: number, length: number): void {
    this.edges[a]!.push({ to: b, length });
    this.edges[b]!.push({ to: a, length });
  }

  private distance(a: number, b: number): number {
    const p = this.nodes[a]!;
    const q = this.nodes[b]!;
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  }
}
