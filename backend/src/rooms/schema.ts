import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import type { RacePhase } from "@shared/network";

/**
 * The live Colyseus state for a race room. These Schema classes are the wire format that
 * Colyseus syncs to every client automatically; they implement the plain shapes in
 * types/network.ts (docs/ARCHITECTURE.md §4). Vectors are nested schemas (x/y/z, x/y/z/w)
 * rather than tuples because Schema can only sync its own field types efficiently — clients
 * read `player.pos.x` and can rebuild the tuple contract if they need it.
 */

export class Vec3Schema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;

  set(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

export class QuatSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") w = 1;

  set(x: number, y: number, z: number, w: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
}

export class RingSchema extends Schema {
  @type("number") id = 0;
  @type(Vec3Schema) pos = new Vec3Schema();
  @type(QuatSchema) quat = new QuatSchema();
  @type("number") radius = 0;
}

export class PlayerSchema extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") duckVariant = "male";
  @type(Vec3Schema) pos = new Vec3Schema();
  @type(Vec3Schema) vel = new Vec3Schema();
  @type(QuatSchema) quat = new QuatSchema();
  @type("number") ringsPassed = 0;
  @type("number") lap = 0;
  @type("number") rank = 0;
  @type("boolean") spunOut = false;
  @type("boolean") finished = false;
  @type("boolean") ready = false;
  /** Player-vs-player collisions this race (display only — never affects rank). */
  @type("number") collisions = 0;
  /** Epoch ms this player finished, or 0 if not finished. */
  @type("number") finishTime = 0;
}

export class RaceState extends Schema {
  @type("string") phase: RacePhase = "lobby";
  /** Short, server-generated invite code for this lobby. */
  @type("string") code = "";
  @type("number") mapSeed = 0;
  @type([RingSchema]) ringLayout = new ArraySchema<RingSchema>();
  /** Epoch ms when the countdown ends (0 outside of countdown). */
  @type("number") countdownEndsAt = 0;
  /** Epoch ms when racing began (0 outside racing/finished); base for elapsed times. */
  @type("number") raceStartAt = 0;
  /** sessionId of the host (the only player allowed to start); "" if the room is empty. */
  @type("string") hostId = "";
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
