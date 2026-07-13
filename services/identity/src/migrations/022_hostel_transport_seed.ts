import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Demo seed for hostel + transport so the portals work end-to-end out of the
 * box (mirrors the sample students in seed.service.ts). Idempotent via guards.
 */
export class SeedHostelTransport1700000000022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Hostel ──
    await queryRunner.query(`
      INSERT INTO hostel_blocks (name, type, warden_name, warden_phone, total_rooms) VALUES
        ('Block B', 'BOYS',  'Mr. Krishnamurthy', '9845012345', 60),
        ('Block G', 'GIRLS', 'Mrs. Lakshmi Rao',  '9845067890', 50)
      ON CONFLICT (name) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO hostel_rooms (block_id, room_number, floor, capacity, occupied)
      SELECT b.id, '204', 2, 3, 0 FROM hostel_blocks b WHERE b.name = 'Block B'
      ON CONFLICT (block_id, room_number) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO mess_menu (block_id, day, breakfast, lunch, dinner)
      SELECT b.id, d.day, d.b, d.l, d.dn FROM hostel_blocks b
      CROSS JOIN (VALUES
        ('Monday','Idli Sambar','Rice Dal Sabzi','Chapati Paneer'),
        ('Tuesday','Upma','Curd Rice','Veg Biryani'),
        ('Wednesday','Dosa Chutney','Rice Sambar','Chapati Dal')
      ) AS d(day,b,l,dn)
      WHERE b.name = 'Block B'
      ON CONFLICT (block_id, day) DO NOTHING;
    `);

    // Allocate CS001 to room 204 if that student's USN exists in allocations space.
    await queryRunner.query(`
      INSERT INTO hostel_allocations (student_usn, room_id, bed_no, mess_type)
      SELECT '1RV21CS001', r.id, 1, 'VEG'
      FROM hostel_rooms r JOIN hostel_blocks b ON b.id = r.block_id
      WHERE b.name = 'Block B' AND r.room_number = '204'
      ON CONFLICT (student_usn) DO NOTHING;
    `);
    await queryRunner.query(`
      UPDATE hostel_rooms SET occupied = 1
      WHERE room_number = '204' AND occupied = 0
        AND EXISTS (SELECT 1 FROM hostel_allocations a WHERE a.room_id = hostel_rooms.id);
    `);

    // ── Transport ──
    await queryRunner.query(`
      INSERT INTO bus_routes (code, name, driver_name, driver_phone, vehicle_no, capacity) VALUES
        ('R4', 'Route 4 — Koramangala to College', 'Suresh N', '9845098765', 'KA01AB1234', 45)
      ON CONFLICT (code) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO bus_stops (route_id, name, seq, pickup_time, lat, lng)
      SELECT r.id, s.name, s.seq, s.t::time, s.lat, s.lng FROM bus_routes r
      CROSS JOIN (VALUES
        ('Koramangala BDA Complex', 1, '07:45', 12.935200, 77.624500),
        ('Forum Mall',              2, '07:55', 12.934600, 77.611000),
        ('College Campus',          3, '08:20', 12.923900, 77.499800)
      ) AS s(name,seq,t,lat,lng)
      WHERE r.code = 'R4'
      ON CONFLICT (route_id, seq) DO NOTHING;
    `);

    await queryRunner.query(`
      INSERT INTO transport_allocations (student_usn, route_id, stop_id, pass_status, valid_until, fee_status)
      SELECT '1RV21CS001', r.id, st.id, 'ACTIVE', CURRENT_DATE + 180, 'PAID'
      FROM bus_routes r JOIN bus_stops st ON st.route_id = r.id AND st.seq = 1
      WHERE r.code = 'R4'
      ON CONFLICT (student_usn) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM transport_allocations WHERE student_usn = '1RV21CS001';`);
    await queryRunner.query(`DELETE FROM bus_routes WHERE code = 'R4';`);
    await queryRunner.query(`DELETE FROM hostel_allocations WHERE student_usn = '1RV21CS001';`);
    await queryRunner.query(`DELETE FROM hostel_blocks WHERE name IN ('Block B', 'Block G');`);
  }
}
