import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bus Transportation — routes, stops, student passes, and a GPS-ready
 * bus_locations table for live tracking. Keyed on students.usn.
 */
export class AddBusTransportation1700000000021 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bus_routes (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code         VARCHAR(20) NOT NULL UNIQUE,
        name         VARCHAR(150) NOT NULL,
        driver_name  VARCHAR(150),
        driver_phone VARCHAR(20),
        vehicle_no   VARCHAR(20),
        capacity     INTEGER NOT NULL DEFAULT 40,
        active       BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMPTZ DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bus_stops (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        route_id    UUID NOT NULL REFERENCES bus_routes(id) ON DELETE CASCADE,
        name        VARCHAR(150) NOT NULL,
        seq         INTEGER NOT NULL,
        pickup_time TIME,
        lat         NUMERIC(9,6),
        lng         NUMERIC(9,6),
        UNIQUE(route_id, seq)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transport_allocations (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_usn VARCHAR(50) NOT NULL UNIQUE,
        route_id    UUID NOT NULL REFERENCES bus_routes(id),
        stop_id     UUID REFERENCES bus_stops(id),
        pass_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | EXPIRED | SUSPENDED
        valid_until DATE,
        fee_status  VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PAID | PENDING | OVERDUE
        created_at  TIMESTAMPTZ DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_transport_alloc_route
        ON transport_allocations (route_id);
    `);

    // Live GPS breadcrumbs — one row per ping. Latest row per route drives the
    // real-time map + ETA. Kept append-only so history is queryable.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bus_locations (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        route_id    UUID NOT NULL REFERENCES bus_routes(id) ON DELETE CASCADE,
        lat         NUMERIC(9,6) NOT NULL,
        lng         NUMERIC(9,6) NOT NULL,
        speed_kmph  NUMERIC(5,1),
        heading     NUMERIC(5,1),
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_bus_locations_latest
        ON bus_locations (route_id, recorded_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of ['bus_locations', 'transport_allocations', 'bus_stops', 'bus_routes']) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t} CASCADE;`);
    }
  }
}
