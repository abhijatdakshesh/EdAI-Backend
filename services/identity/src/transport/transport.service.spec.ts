import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { TransportService } from './transport.service';
import { EventsGateway } from '../events/events.gateway';

describe('TransportService', () => {
  let service: TransportService;
  let db: { query: jest.Mock };
  let events: { emitBusLocation: jest.Mock };

  beforeEach(async () => {
    db = { query: jest.fn() };
    events = { emitBusLocation: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TransportService,
        { provide: getDataSourceToken(), useValue: db },
        { provide: EventsGateway, useValue: events },
      ],
    }).compile();
    service = moduleRef.get(TransportService);
  });

  it('returns null transport when the student has no allocation', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.getStudentTransport('x')).resolves.toBeNull();
  });

  it('computes ETA from the live location to the student stop', async () => {
    db.query
      // allocation join
      .mockResolvedValueOnce([{
        student_usn: '1RV21CS001', pass_status: 'ACTIVE', fee_status: 'PAID', valid_until: null,
        route_id: 'r1', route_code: 'R4', route_name: 'Koramangala', driver_name: 'Ravi',
        driver_phone: '9', vehicle_no: 'KA01', stop_name: 'BDA', pickup_time: '07:45',
        stop_lat: '12.9352', stop_lng: '77.6245',
      }])
      // latestLocation
      .mockResolvedValueOnce([{
        route_id: 'r1', lat: '12.9767', lng: '77.5713', speed_kmph: '30', heading: null,
        recorded_at: '2026-07-13T02:00:00Z',
      }]);

    const res = await service.getStudentTransport('1RV21CS001');
    expect(res!.routeCode).toBe('R4');
    expect(res!.live).not.toBeNull();
    expect(res!.etaMinutes).toBeGreaterThan(0);
  });

  it('records a GPS ping and broadcasts it', async () => {
    db.query.mockResolvedValue([{
      route_id: 'r1', lat: '12.97', lng: '77.57', speed_kmph: '25', heading: '90',
      recorded_at: '2026-07-13T02:05:00Z',
    }]);
    const loc = await service.recordLocation('r1', 12.97, 77.57, 25, 90);
    expect(loc!.lat).toBeCloseTo(12.97);
    expect(events.emitBusLocation).toHaveBeenCalledTimes(1);
    expect(events.emitBusLocation.mock.calls[0][0].routeId).toBe('r1');
  });

  it('gracefully returns null with no DB', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TransportService,
        { provide: getDataSourceToken(), useValue: null },
        { provide: EventsGateway, useValue: events },
      ],
    }).compile();
    await expect(moduleRef.get(TransportService).latestLocation('r1')).resolves.toBeNull();
  });
});
