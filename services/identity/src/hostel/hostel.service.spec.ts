import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { HostelService } from './hostel.service';

describe('HostelService', () => {
  let service: HostelService;
  let db: { query: jest.Mock; transaction: jest.Mock };

  beforeEach(async () => {
    db = { query: jest.fn(), transaction: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [HostelService, { provide: getDataSourceToken(), useValue: db }],
    }).compile();
    service = moduleRef.get(HostelService);
  });

  it('returns null hostel when no allocation exists', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.getStudentHostel('x')).resolves.toBeNull();
  });

  it('joins allocation + block + mess menu', async () => {
    db.query
      .mockResolvedValueOnce([{
        student_usn: '1RV21CS001', bed_no: '1', mess_type: 'VEG', status: 'ACTIVE',
        room_number: '204', floor: '2', block_id: 'b1', block: 'Block B', block_type: 'BOYS',
        warden_name: 'Mr K', warden_phone: '9',
      }])
      .mockResolvedValueOnce([{ day: 'Monday', breakfast: 'Idli', lunch: 'Rice', dinner: 'Chapati' }]);
    const res = await service.getStudentHostel('1RV21CS001');
    expect(res!.block).toBe('Block B');
    expect(res!.messMenu).toHaveLength(1);
  });

  it('raises a complaint', async () => {
    db.query.mockResolvedValue([{
      id: 'c1', student_usn: '1RV21CS001', category: 'PLUMBING', description: 'leak',
      status: 'OPEN', created_at: 'now', resolved_at: null,
    }]);
    const c = await service.raiseComplaint('1RV21CS001', 'PLUMBING', 'leak');
    expect(c!.status).toBe('OPEN');
    expect(c!.category).toBe('PLUMBING');
  });

  it('rejects allocation into a full room (transaction)', async () => {
    db.transaction.mockImplementation(async (cb: (mgr: unknown) => unknown) => {
      const mgr = { query: jest.fn().mockResolvedValueOnce([{ capacity: '2', occupied: '2' }]) };
      return cb(mgr);
    });
    const res = await service.allocateRoom('1RV21CS001', 'room1');
    expect(res).toEqual({ ok: false, reason: 'room-full' });
  });

  it('allocates into a room with space and bumps occupancy', async () => {
    const mgr = {
      query: jest.fn()
        .mockResolvedValueOnce([{ capacity: '3', occupied: '1' }]) // room lock
        .mockResolvedValueOnce([]) // insert alloc
        .mockResolvedValueOnce([]), // update occupancy
    };
    db.transaction.mockImplementation(async (cb: (m: unknown) => unknown) => cb(mgr));
    const res = await service.allocateRoom('1RV21CS001', 'room1', 2, 'NONVEG');
    expect(res).toEqual({ ok: true });
    expect(mgr.query).toHaveBeenCalledTimes(3);
  });

  it('returns [] for complaints with no DB', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HostelService, { provide: getDataSourceToken(), useValue: null }],
    }).compile();
    await expect(moduleRef.get(HostelService).listComplaints()).resolves.toEqual([]);
  });
});
