import { Test, TestingModule } from '@nestjs/testing';
import { CommsService, AICallLog, Message } from './comms.service';
import { EventsGateway } from '../events/events.gateway';
import { ConsentService } from './consent.service';
import { ConversationStateService } from './conversation-state.service';
import { KnowledgeGraphService } from '../chatbot/knowledge-graph.service';

const mockEvents = { emitAiCallCompleted: jest.fn(), emitAiCallTurn: jest.fn() };

const makeCall = (overrides: Partial<AICallLog> = {}): AICallLog => ({
  id: 'call-1',
  calledAt: '2026-04-01T10:00:00Z',
  studentName: 'Alice',
  studentUsn: 'USN001',
  parentId: 'parent-1',
  outcome: 'ANSWERED',
  duration: 120,
  ...overrides,
});

describe('CommsService', () => {
  let service: CommsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommsService,
        ConsentService,
        ConversationStateService,
        { provide: KnowledgeGraphService, useValue: { buildStudentGraph: jest.fn().mockResolvedValue({}) } },
        { provide: EventsGateway, useValue: mockEvents },
      ],
    }).compile();

    service = module.get<CommsService>(CommsService);
  });

  // ─── getRecentCalls ─────────────────────────────────────────────────────────

  describe('getRecentCalls()', () => {
    it('returns calls in reverse order with default limit 20', () => {
      service.callLogs.push(makeCall({ id: 'c1' }), makeCall({ id: 'c2' }), makeCall({ id: 'c3' }));
      const result = service.getRecentCalls();
      expect(result[0].id).toBe('c3');
      expect(result[1].id).toBe('c2');
      expect(result[2].id).toBe('c1');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 25; i++) {
        service.callLogs.push(makeCall({ id: `c${i}` }));
      }
      expect(service.getRecentCalls(5)).toHaveLength(5);
    });

    it('returns empty array when no calls', () => {
      expect(service.getRecentCalls()).toEqual([]);
    });
  });

  // ─── getParentCalls ─────────────────────────────────────────────────────────

  describe('getParentCalls()', () => {
    it('returns only calls for the given parentId', () => {
      service.callLogs.push(
        makeCall({ id: 'c1', parentId: 'parent-1' }),
        makeCall({ id: 'c2', parentId: 'parent-2' }),
      );
      const result = service.getParentCalls('parent-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
    });

    it('returns empty array for unknown parentId', () => {
      service.callLogs.push(makeCall({ parentId: 'parent-X' }));
      expect(service.getParentCalls('unknown')).toEqual([]);
    });
  });

  // ─── getParentMessages ──────────────────────────────────────────────────────

  describe('getParentMessages()', () => {
    it('returns messages for the given parentId', () => {
      const msg: Message = {
        id: 'm1',
        parentId: 'parent-1',
        content: 'Hello',
        direction: 'OUTBOUND',
        sentAt: '2026-04-01T10:00:00Z',
        channel: 'WHATSAPP',
      };
      service.messages.push(msg, { ...msg, id: 'm2', parentId: 'parent-2' });

      const result = service.getParentMessages('parent-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('m1');
    });

    it('returns empty array for unknown parentId', () => {
      expect(service.getParentMessages('nobody')).toEqual([]);
    });
  });

  // ─── getAdminCallLogs ───────────────────────────────────────────────────────

  describe('getAdminCallLogs()', () => {
    it('returns all call logs', () => {
      service.callLogs.push(makeCall({ id: 'c1' }), makeCall({ id: 'c2' }));
      expect(service.getAdminCallLogs()).toHaveLength(2);
    });

    it('returns empty array when no logs', () => {
      expect(service.getAdminCallLogs()).toEqual([]);
    });
  });

  // ─── completeCall ───────────────────────────────────────────────────────────

  describe('completeCall()', () => {
    it('emits ai-call completed event when call log is found', () => {
      service.callLogs.push(makeCall({ id: 'call-1', studentUsn: 'USN001' }));
      service.completeCall('call-1', 'USN001');
      expect(mockEvents.emitAiCallCompleted).toHaveBeenCalledWith({
        callId: 'call-1',
        studentUsn: 'USN001',
      });
    });

    it('does NOT emit when call log is not found', () => {
      service.completeCall('no-such-call', 'USN001');
      expect(mockEvents.emitAiCallCompleted).not.toHaveBeenCalled();
    });
  });

  // ─── getAnnouncements ───────────────────────────────────────────────────────

  describe('getAnnouncements()', () => {
    it('returns only announcements for the given institutionId', () => {
      service.createAnnouncement('Title RVCE', 'Content', 'ALL', 'rvce');
      service.createAnnouncement('Title RVITM', 'Content', 'ALL', 'rvitm');
      expect(service.getAnnouncements('rvce')).toHaveLength(1);
      expect(service.getAnnouncements('rvce')[0].title).toBe('Title RVCE');
    });

    it('returns empty array for unknown institutionId (multi-tenant isolation)', () => {
      service.createAnnouncement('Title', 'Content', 'ALL', 'rvce');
      expect(service.getAnnouncements('unknown-tenant')).toEqual([]);
    });

    it('returns empty array when no announcements exist', () => {
      expect(service.getAnnouncements('rvce')).toEqual([]);
    });
  });

  // ─── createAnnouncement ─────────────────────────────────────────────────────

  describe('createAnnouncement()', () => {
    it('defaults institutionId to "default" when not provided', () => {
      const ann = service.createAnnouncement('Test', 'Body', 'STUDENTS');
      expect(ann.institutionId).toBe('default');
      expect(service.getAnnouncements('default')).toHaveLength(1);
    });

    it('pushes announcement to the announcements array', () => {
      service.createAnnouncement('T1', 'C1', 'ALL', 'rvce');
      service.createAnnouncement('T2', 'C2', 'FACULTY', 'rvce');
      expect(service.announcements).toHaveLength(2);
    });

    it('returns the created announcement with all fields', () => {
      const ann = service.createAnnouncement('Hello', 'World', 'ADMIN', 'rvce');
      expect(ann.id).toMatch(/^ann-/);
      expect(ann.title).toBe('Hello');
      expect(ann.audience).toBe('ADMIN');
      expect(ann.institutionId).toBe('rvce');
      expect(ann.createdAt).toBeDefined();
    });
  });

  // ─── getCallsByClass ────────────────────────────────────────────────────────

  describe('getCallsByClass()', () => {
    it('returns calls for the given classId', () => {
      service.callLogs.push(
        makeCall({ id: 'c1', classId: 'class-cs501-a' }),
        makeCall({ id: 'c2', classId: 'class-ec601-b' }),
      );
      expect(service.getCallsByClass('class-cs501-a')).toHaveLength(1);
    });

    it('filters by institutionId when provided', () => {
      service.callLogs.push(
        makeCall({ id: 'c1', classId: 'cls-1', institutionId: 'rvce' }),
        makeCall({ id: 'c2', classId: 'cls-1', institutionId: 'rvitm' }),
      );
      expect(service.getCallsByClass('cls-1', 'rvce')).toHaveLength(1);
      expect(service.getCallsByClass('cls-1', 'rvce')[0].institutionId).toBe('rvce');
    });

    it('returns all classId matches when no institutionId filter', () => {
      service.callLogs.push(
        makeCall({ id: 'c1', classId: 'cls-1', institutionId: 'rvce' }),
        makeCall({ id: 'c2', classId: 'cls-1', institutionId: 'rvitm' }),
      );
      expect(service.getCallsByClass('cls-1')).toHaveLength(2);
    });

    it('returns empty array when no calls match classId', () => {
      service.callLogs.push(makeCall({ id: 'c1', classId: 'cls-a' }));
      expect(service.getCallsByClass('cls-b')).toEqual([]);
    });
  });

  // ─── getAudio ────────────────────────────────────────────────────────────────

  describe('getAudio()', () => {
    it('returns undefined for unknown callId', () => {
      expect(service.getAudio('nonexistent-call')).toBeUndefined();
    });

    it('returns Buffer stored for a known callId', () => {
      (service as any).audioStore.set('call-test', Buffer.from('fake-wav'));
      const result = service.getAudio('call-test');
      expect(result).toBeDefined();
      expect(result!.toString()).toBe('fake-wav');
    });
  });

  // ─── triggerCall ────────────────────────────────────────────────────────────

  describe('triggerCall()', () => {
    it('returns QUEUED status with a callId and scheduledAt 5 min in future', async () => {
      service.grantConsent('USN001', ['ATTENDANCE_ALERTS']);
      const before = Date.now();
      const result = await service.triggerCall('USN001', 'ATTENDANCE');
      const after = Date.now();
      expect(result.status).toBe('QUEUED');
      expect(result.callId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      const scheduled = new Date(result.scheduledAt).getTime();
      expect(scheduled).toBeGreaterThan(before);
      expect(scheduled).toBeLessThanOrEqual(after + 5 * 60 * 1000 + 1000);
    });

    it('pushes a callLog entry for regional language (kn)', async () => {
      const before = service.callLogs.length;
      await service.triggerCall('1RV21CS001', 'ABSENT_CALL', 'rvce', 'kn');
      expect(service.callLogs.length).toBe(before + 1);
      const log = service.callLogs[service.callLogs.length - 1];
      expect(log.studentUsn).toBe('1RV21CS001');
      expect(log.language).toBe('kn');
    });

    it('pushes a callLog entry for Hindi (hi)', async () => {
      const before = service.callLogs.length;
      await service.triggerCall('1RV21CS001', 'FEE_REMINDER', 'rvce', 'hi');
      expect(service.callLogs[service.callLogs.length - 1].language).toBe('hi');
    });

    it('does not crash when parentPhone is missing', async () => {
      await expect(
        service.triggerCall('UNKNOWN_USN_NO_PHONE', 'ABSENT_CALL', 'rvce', 'kn')
      ).resolves.toMatchObject({ status: 'QUEUED' });
    });

    it('falls back to ABSENT_CALL script for unknown type', async () => {
      const result = await service.triggerCall('1RV21CS001', 'UNKNOWN_TYPE', 'rvce', 'en');
      expect(result.status).toBe('QUEUED');
    });

    // ── Multi-language coverage (KAN-voice-multi-lang) ────────────────────────
    // Verify that all 11 supported Indian languages can trigger a call without
    // crashing, persist the language on the call log, and the regional path
    // (non-`en`) attempts Sarvam audio generation with the correct
    // target_language_code (od-IN for Odia, mr-IN/bn-IN/gu-IN/ml-IN/pa-IN otherwise).
    describe.each([
      { lang: 'mr', sarvam: 'mr-IN' },
      { lang: 'bn', sarvam: 'bn-IN' },
      { lang: 'gu', sarvam: 'gu-IN' },
      { lang: 'ml', sarvam: 'ml-IN' },
      { lang: 'pa', sarvam: 'pa-IN' },
      { lang: 'or', sarvam: 'od-IN' },
    ])('regional language: $lang', ({ lang, sarvam }) => {
      it(`persists callLog.language=${lang} and calls Sarvam with target_language_code=${sarvam}`, async () => {
        process.env['SARVAM_API_KEY'] = 'test-key';
        const fetchSpy = jest.fn().mockResolvedValue({
          json: () => Promise.resolve({ audios: [Buffer.from('fake').toString('base64')] }),
        });
        global.fetch = fetchSpy as never;

        const before = service.callLogs.length;
        await service.triggerCall('1RV21CS001', 'ABSENT_CALL', 'rvce', lang);

        // Allow the fire-and-forget Sarvam → Twilio chain to flush.
        await new Promise((r) => setImmediate(r));

        expect(service.callLogs.length).toBe(before + 1);
        const log = service.callLogs[service.callLogs.length - 1];
        expect(log.language).toBe(lang);

        const sarvamCall = fetchSpy.mock.calls.find(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('sarvam.ai'),
        );
        expect(sarvamCall).toBeDefined();
        const body = JSON.parse((sarvamCall![1] as { body: string }).body);
        expect(body.target_language_code).toBe(sarvam);

        delete process.env['SARVAM_API_KEY'];
      });
    });
  });

  // ─── sendSms ────────────────────────────────────────────────────────────────

  describe('sendSms()', () => {
    it('returns messageId and status SENT', () => {
      const result = service.sendSms('+919876543210', 'Attendance alert');
      expect(result.status).toBe('SENT');
      expect(result.messageId).toMatch(/^sms-/);
    });
  });

  // ─── triggerParentCall ──────────────────────────────────────────────────────

  describe('triggerParentCall()', () => {
    it('returns callId and QUEUED status', () => {
      service.grantConsent('parent-01', ['ATTENDANCE_ALERTS']);
      const result = service.triggerParentCall('parent-01', '1RV21CS001');
      expect(result.callId).toMatch(/^pcall-/);
      expect(result.status).toBe('QUEUED');
    });
  });

  // ─── getNotifications ───────────────────────────────────────────────────────

  describe('getNotifications()', () => {
    it('returns stub 2-item array when no stored notifications for parentId', () => {
      const result = service.getNotifications('new-parent');
      expect(result).toHaveLength(2);
      expect(['ATTENDANCE', 'FEES']).toContain(result[0].type);
    });

    it('returns only stored notifications when they exist for parentId', () => {
      service.notifications.push({
        id: 'n1',
        parentId: 'parent-stored',
        type: 'MARKS',
        title: 'Marks Updated',
        message: 'IA marks released',
        read: false,
        createdAt: new Date().toISOString(),
      });
      const result = service.getNotifications('parent-stored');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n1');
    });

    it('does not cross-contaminate notifications between parents', () => {
      service.notifications.push({
        id: 'n1', parentId: 'p-a', type: 'FEES', title: 'Fee', message: 'Due', read: false, createdAt: new Date().toISOString(),
      });
      expect(service.getNotifications('p-b')).toHaveLength(2); // stub fallback
    });
  });

  // ─── markNotificationRead ───────────────────────────────────────────────────

  describe('markNotificationRead()', () => {
    it('marks a known notification as read', () => {
      service.notifications.push({
        id: 'n-unread', parentId: 'p1', type: 'FEES', title: 'Fee Due', message: 'Pay now', read: false, createdAt: new Date().toISOString(),
      });
      const result = service.markNotificationRead('n-unread');
      expect(result.ok).toBe(true);
      expect(service.notifications[0].read).toBe(true);
    });

    it('is a no-op (does not throw) for unknown notification id', () => {
      expect(() => service.markNotificationRead('unknown-id')).not.toThrow();
      expect(service.markNotificationRead('unknown-id').ok).toBe(true);
    });
  });

  // ─── markAllRead ────────────────────────────────────────────────────────────

  describe('markAllRead()', () => {
    it('marks all unread notifications for a parentId and returns count', () => {
      service.notifications.push(
        { id: 'n1', parentId: 'p-all', type: 'A', title: 'T', message: 'M', read: false, createdAt: new Date().toISOString() },
        { id: 'n2', parentId: 'p-all', type: 'B', title: 'T', message: 'M', read: false, createdAt: new Date().toISOString() },
        { id: 'n3', parentId: 'p-all', type: 'C', title: 'T', message: 'M', read: true, createdAt: new Date().toISOString() },
      );
      const result = service.markAllRead('p-all');
      expect(result.ok).toBe(true);
      expect(result.count).toBe(2);
      expect(service.notifications.every((n) => n.parentId !== 'p-all' || n.read)).toBe(true);
    });

    it('returns count 0 when all already read', () => {
      service.notifications.push({
        id: 'n1', parentId: 'p-done', type: 'A', title: 'T', message: 'M', read: true, createdAt: new Date().toISOString(),
      });
      expect(service.markAllRead('p-done').count).toBe(0);
    });

    it('returns count 0 for parentId with no notifications', () => {
      expect(service.markAllRead('nobody').count).toBe(0);
    });
  });

  // ─── onModuleInit (DB hydration) ─────────────────────────────────────────────

  describe('onModuleInit()', () => {
    it('skips hydration when no repos injected', async () => {
      const mockEvts = { emitAiCallCompleted: jest.fn(), emitAiCallTurn: jest.fn() };
      const consent = new ConsentService(null);
      const svc = new CommsService(mockEvts as any, consent);
      await svc.onModuleInit();
      expect(svc.callLogs).toEqual([]);
      expect(svc.announcements).toEqual([]);
    });

    it('hydrates callLogs from DB, converts Date calledAt to ISO string', async () => {
      const mockRow = { id: 'call-db-1', studentUsn: 'USN001', studentName: 'Alice', parentId: 'p1', outcome: 'ANSWERED', duration: 60, transcript: null, summary: null, institutionId: 'rvce', classId: 'CS-A', calledAt: new Date('2026-04-01T10:00:00Z') };
      const mockCallRepo = { find: jest.fn().mockResolvedValue([mockRow]), order: {}, take: 500 };
      const consent = new ConsentService(null);
      const svc = new CommsService(
        { emitAiCallCompleted: jest.fn(), emitAiCallTurn: jest.fn() } as any,
        consent,
        undefined,
        undefined,
        mockCallRepo as any,
        undefined,
      );
      await svc.onModuleInit();
      expect(svc.callLogs).toHaveLength(1);
      expect(svc.callLogs[0].calledAt).toBe('2026-04-01T10:00:00.000Z');
    });

    it('hydrates announcements from DB', async () => {
      const mockRow = { id: 'ann-db-1', institutionId: 'rvce', title: 'Holiday', content: 'No class', audience: 'ALL', createdAt: new Date('2026-04-10T09:00:00Z') };
      const mockAnnRepo = { find: jest.fn().mockResolvedValue([mockRow]) };
      const consent = new ConsentService(null);
      const svc = new CommsService(
        { emitAiCallCompleted: jest.fn(), emitAiCallTurn: jest.fn() } as any,
        consent,
        undefined,
        undefined,
        undefined,
        mockAnnRepo as any,
      );
      await svc.onModuleInit();
      expect(svc.announcements).toHaveLength(1);
      expect(svc.announcements[0].title).toBe('Holiday');
      expect(svc.announcements[0].createdAt).toBe('2026-04-10T09:00:00.000Z');
    });

    it('seeds VOICE consent for demo USNs in rvce institution', async () => {
      // Without this, the prod admin Voice Calling demo 403s with
      // "principal <usn> has not consented to VOICE communications" because
      // SeedService only runs on dev profiles. Voice consent for the
      // hardcoded demo USNs lets the call trigger succeed without manual
      // grant calls. Real students still require explicit opt-in.
      const mockEvts = { emitAiCallCompleted: jest.fn(), emitAiCallTurn: jest.fn() };
      const consent = new ConsentService(null);
      const svc = new CommsService(mockEvts as any, consent);
      await svc.onModuleInit();
      expect(consent.hasConsent('1RV21CS001', 'VOICE', 'rvce')).toBe(true);
      expect(consent.hasConsent('1RV21CS002', 'VOICE', 'rvce')).toBe(true);
      expect(consent.hasConsent('1RV21CS003', 'VOICE', 'rvce')).toBe(true);
    });
  });

  // ─── getAdminCallLogs — institutionId filter ────────────────────────────────

  describe('getAdminCallLogs() — institutionId filter', () => {
    it('returns all logs when no institutionId provided', () => {
      service.callLogs.push(
        makeCall({ id: 'c1', institutionId: 'rvce' }),
        makeCall({ id: 'c2', institutionId: 'rvitm' }),
      );
      expect(service.getAdminCallLogs()).toHaveLength(2);
    });

    it('returns only logs matching institutionId when provided', () => {
      service.callLogs.push(
        makeCall({ id: 'c1', institutionId: 'rvce' }),
        makeCall({ id: 'c2', institutionId: 'rvitm' }),
      );
      const result = service.getAdminCallLogs('rvce');
      expect(result).toHaveLength(1);
      expect(result[0].institutionId).toBe('rvce');
    });
  });

  // ─── generateSarvamAudio — private method coverage ─────────────────────────

  describe('generateSarvamAudio() — private method', () => {
    it('returns null when SARVAM_API_KEY is not set', async () => {
      const savedKey = process.env['SARVAM_API_KEY'];
      delete process.env['SARVAM_API_KEY'];
      const result = await (service as any).generateSarvamAudio('hello', 'kn-IN');
      expect(result).toBeNull();
      if (savedKey) process.env['SARVAM_API_KEY'] = savedKey;
    });

    it('returns buffer when Sarvam returns base64 audio', async () => {
      process.env['SARVAM_API_KEY'] = 'test-key';
      const fakeAudio = Buffer.from('fake-wav-data').toString('base64');
      global.fetch = jest.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ audios: [fakeAudio] }),
      } as never);
      const result = await (service as any).generateSarvamAudio('hello', 'kn-IN');
      expect(result).toBeInstanceOf(Buffer);
      delete process.env['SARVAM_API_KEY'];
    });

    it('returns null when Sarvam returns no audios array', async () => {
      process.env['SARVAM_API_KEY'] = 'test-key';
      global.fetch = jest.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({}),
      } as never);
      const result = await (service as any).generateSarvamAudio('hello', 'kn-IN');
      expect(result).toBeNull();
      delete process.env['SARVAM_API_KEY'];
    });

    it('returns null when fetch throws', async () => {
      process.env['SARVAM_API_KEY'] = 'test-key';
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('network error'));
      const result = await (service as any).generateSarvamAudio('hello', 'kn-IN');
      expect(result).toBeNull();
      delete process.env['SARVAM_API_KEY'];
    });
  });

  // ─── dispatchTwilioCall — private method coverage ──────────────────────────

  describe('dispatchTwilioCall() — private method', () => {
    it('returns null when TWILIO credentials are missing', async () => {
      const sid = process.env['TWILIO_ACCOUNT_SID'];
      const token = process.env['TWILIO_AUTH_TOKEN'];
      const from = process.env['TWILIO_PHONE_NUMBER'];
      delete process.env['TWILIO_ACCOUNT_SID'];
      delete process.env['TWILIO_AUTH_TOKEN'];
      delete process.env['TWILIO_PHONE_NUMBER'];
      const result = await (service as any).dispatchTwilioCall('+911234567890', 'http://example.com/twiml');
      expect(result).toBeNull();
      if (sid) process.env['TWILIO_ACCOUNT_SID'] = sid;
      if (token) process.env['TWILIO_AUTH_TOKEN'] = token;
      if (from) process.env['TWILIO_PHONE_NUMBER'] = from;
    });

    it('returns call SID string when Twilio responds with sid', async () => {
      process.env['TWILIO_ACCOUNT_SID'] = 'AC-test';
      process.env['TWILIO_AUTH_TOKEN'] = 'token-test';
      process.env['TWILIO_PHONE_NUMBER'] = '+1234567890';
      global.fetch = jest.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ sid: 'CA-test-sid' }),
      } as never);
      const result = await (service as any).dispatchTwilioCall('+911234567890', 'http://example.com/twiml');
      expect(result).toBe('CA-test-sid');
      delete process.env['TWILIO_ACCOUNT_SID'];
      delete process.env['TWILIO_AUTH_TOKEN'];
      delete process.env['TWILIO_PHONE_NUMBER'];
    });

    it('returns null when Twilio fetch throws', async () => {
      process.env['TWILIO_ACCOUNT_SID'] = 'AC-test';
      process.env['TWILIO_AUTH_TOKEN'] = 'token-test';
      process.env['TWILIO_PHONE_NUMBER'] = '+1234567890';
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('twilio down'));
      const result = await (service as any).dispatchTwilioCall('+911234567890', 'http://example.com/twiml');
      expect(result).toBeNull();
      delete process.env['TWILIO_ACCOUNT_SID'];
      delete process.env['TWILIO_AUTH_TOKEN'];
      delete process.env['TWILIO_PHONE_NUMBER'];
    });
  });

  // ─── Interactive turn handling ──────────────────────────────────────────────

  describe('handleTurn() — interactive', () => {
    let conv: ConversationStateService;
    let svc: CommsService;
    const events = { emitAiCallCompleted: jest.fn(), emitAiCallTurn: jest.fn() };

    beforeEach(() => {
      jest.clearAllMocks();
      conv = new ConversationStateService();
      const consent = new ConsentService(null);
      svc = new CommsService(events as any, consent, conv, undefined);
      // Pre-populate state for "call-X"
      conv.init('call-X', { usn: 'USN1', language: 'en', callType: 'ABSENT_CALL', institutionId: 'rvce' });
      conv.pushTurn('call-X', 'AI', 'Hello, this is EdAI', 'en');
    });

    it('returns hangup TwiML when call session is missing', async () => {
      const xml = await svc.handleTurn('missing-call', 'hi');
      expect(xml).toContain('<Hangup');
    });

    it('hangs up gracefully on stop intent', async () => {
      const xml = await svc.handleTurn('call-X', 'please stop calling');
      expect(xml).toContain('<Hangup');
      expect(events.emitAiCallTurn).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'PARENT', text: 'please stop calling' }),
      );
    });

    it('hangs up after MAX_TURNS reached', async () => {
      // 12 turns already pushed (MAX_TURNS*2). Should goodbye.
      for (let i = 0; i < 11; i++) conv.pushTurn('call-X', i % 2 === 0 ? 'PARENT' : 'AI', `t${i}`, 'en');
      const xml = await svc.handleTurn('call-X', 'tell me more');
      expect(xml).toContain('<Hangup');
    });

    it('emits PARENT then AI turns and returns Gather TwiML on normal turn', async () => {
      // Mock geminiGenerate to return a short reply.
      const gem = require('../shared/gemini-ai');
      const spy = jest.spyOn(gem, 'geminiGenerate').mockResolvedValue('Thank you. Is there anything else?');
      const xml = await svc.handleTurn('call-X', 'My son was sick yesterday');
      expect(spy).toHaveBeenCalled();
      expect(xml).toContain('<Gather');
      expect(xml).toContain('<Say');
      // PARENT first, AI second
      const calls = events.emitAiCallTurn.mock.calls.map(c => c[0]);
      expect(calls.find(c => c.role === 'PARENT')).toBeTruthy();
      expect(calls.find(c => c.role === 'AI' && c.text.includes('Thank you'))).toBeTruthy();
      spy.mockRestore();
    });

    it('respects 25-word cap on AI reply', async () => {
      const gem = require('../shared/gemini-ai');
      const long = 'word '.repeat(60).trim();
      const spy = jest.spyOn(gem, 'geminiGenerate').mockResolvedValue(long);
      await svc.handleTurn('call-X', 'tell me a story');
      const aiTurn = events.emitAiCallTurn.mock.calls
        .map(c => c[0])
        .find(c => c.role === 'AI' && c.text.startsWith('word'));
      expect(aiTurn).toBeDefined();
      expect(aiTurn.text.split(/\s+/).length).toBeLessThanOrEqual(25);
      spy.mockRestore();
    });

    // ── AI→human live transfer (handoff) ──────────────────────────────────────
    it('transfers to agent (<Dial><Number>) when caller asks for a human and agent phone is set', async () => {
      process.env['SUPPORT_AGENT_PHONE'] = '+919900000000';
      const xml = await svc.handleTurn('call-X', 'can you connect me to a human');
      expect(xml).toContain('<Dial');
      expect(xml).toContain('<Number>+919900000000</Number>');
      expect(xml).toContain('/transfer-result');
      // a system "Transfer→human" turn is recorded
      const aiTurn = events.emitAiCallTurn.mock.calls
        .map((c) => c[0])
        .find((c) => c.role === 'AI' && /Transfer/i.test(c.text));
      expect(aiTurn).toBeTruthy();
      delete process.env['SUPPORT_AGENT_PHONE'];
    });

    it('falls back to goodbye/hangup on human request when no agent phone configured', async () => {
      delete process.env['SUPPORT_AGENT_PHONE'];
      const xml = await svc.handleTurn('call-X', 'I want to talk to a representative');
      expect(xml).toContain('<Hangup');
      expect(xml).not.toContain('<Dial');
    });

    it('finalizeTransfer: completed → bare hangup; no-answer → fallback message + hangup', async () => {
      const completed = await svc.finalizeTransfer('call-X', 'completed', 42);
      expect(completed).toContain('<Hangup');
      expect(completed).not.toContain('<Say');
      const failed = await svc.finalizeTransfer('call-X', 'no-answer');
      expect(failed).toContain('<Say');
      expect(failed).toContain('<Hangup');
    });

    // ── BCP47 Gather tag for all new regional languages ───────────────────────
    describe.each([
      { lang: 'mr', tag: 'mr-IN' },
      { lang: 'bn', tag: 'bn-IN' },
      { lang: 'gu', tag: 'gu-IN' },
      { lang: 'ml', tag: 'ml-IN' },
      { lang: 'pa', tag: 'pa-IN' },
      { lang: 'or', tag: 'or-IN' },
    ])('handleTurn for $lang emits <Gather language="$tag">', ({ lang, tag }) => {
      it(`returns <Gather language="${tag}"> for ${lang}`, async () => {
        process.env['SARVAM_API_KEY'] = 'test-key';
        // Sarvam returns a fake base64 audio so the regional Play branch executes.
        global.fetch = jest.fn().mockResolvedValue({
          json: () => Promise.resolve({ audios: [Buffer.from('fake').toString('base64')] }),
        }) as never;

        const conv2 = new ConversationStateService();
        const consent2 = new ConsentService(null);
        const svc2 = new CommsService(events as any, consent2, conv2, undefined);
        conv2.init(`call-${lang}`, { usn: 'USNX', language: lang, callType: 'ABSENT_CALL', institutionId: 'rvce' });
        conv2.pushTurn(`call-${lang}`, 'AI', 'greet', lang);

        const gem = require('../shared/gemini-ai');
        const spy = jest.spyOn(gem, 'geminiGenerate').mockResolvedValue('Reply.');

        const xml = await svc2.handleTurn(`call-${lang}`, 'parent input');
        expect(xml).toContain(`<Gather`);
        expect(xml).toContain(`language="${tag}"`);

        // Transcript: PARENT and AI turn both pushed.
        const turns = conv2.get(`call-${lang}`)!.turns;
        expect(turns.find(t => t.role === 'PARENT' && t.text === 'parent input')).toBeDefined();
        expect(turns.find(t => t.role === 'AI' && t.text === 'Reply.')).toBeDefined();

        spy.mockRestore();
        delete process.env['SARVAM_API_KEY'];
      });
    });

    it('hangs up when consent record exists but VOICE channel is missing', async () => {
      const consent = new ConsentService(null);
      const conv2 = new ConversationStateService();
      const svc2 = new CommsService(events as any, consent, conv2, undefined);
      consent.grant('USN2', ['ATTENDANCE_ALERTS'], 'rvce'); // no VOICE
      conv2.init('call-Y', { usn: 'USN2', language: 'en', callType: 'ABSENT_CALL', institutionId: 'rvce' });
      const xml = await svc2.handleTurn('call-Y', 'hello');
      expect(xml).toContain('<Hangup');
    });
  });

  describe('finalizeCall()', () => {
    it('writes transcript+summary, emits ai-call:completed, evicts state', async () => {
      const events = { emitAiCallCompleted: jest.fn(), emitAiCallTurn: jest.fn() };
      const consent = new ConsentService(null);
      const conv = new ConversationStateService();
      const svc = new CommsService(events as any, consent, conv, undefined);
      conv.init('call-Z', { usn: 'USN-Z', language: 'en', callType: 'ABSENT_CALL', institutionId: 'rvce' });
      conv.pushTurn('call-Z', 'AI', 'Hi', 'en');
      conv.pushTurn('call-Z', 'PARENT', 'Hello', 'en');
      svc.callLogs.push({
        id: 'call-Z', studentUsn: 'USN-Z', studentName: 'X', parentId: '',
        outcome: 'NO_ANSWER', duration: 0, calledAt: new Date().toISOString(),
        institutionId: 'rvce',
      });

      const gem = require('../shared/gemini-ai');
      const spy = jest.spyOn(gem, 'geminiGenerate').mockResolvedValue('Parent acknowledged.');

      await svc.finalizeCall('call-Z', 'completed');
      const log = svc.callLogs.find(c => c.id === 'call-Z')!;
      expect(log.outcome).toBe('ANSWERED');
      expect(log.transcript).toBeDefined();
      expect(JSON.parse(log.transcript!)).toHaveLength(2);
      expect(log.summary).toBe('Parent acknowledged.');
      expect(events.emitAiCallCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ callId: 'call-Z', studentUsn: 'USN-Z' }),
      );
      expect(conv.get('call-Z')).toBeUndefined();
      spy.mockRestore();
    });

    it('does NOT persist transcript when consent record exists without VOICE', async () => {
      const events = { emitAiCallCompleted: jest.fn(), emitAiCallTurn: jest.fn() };
      const consent = new ConsentService(null);
      const conv = new ConversationStateService();
      const svc = new CommsService(events as any, consent, conv, undefined);
      consent.grant('USN-NV', ['ATTENDANCE_ALERTS'], 'rvce');
      conv.init('call-NV', { usn: 'USN-NV', language: 'en', callType: 'ABSENT_CALL', institutionId: 'rvce' });
      conv.pushTurn('call-NV', 'AI', 'Hi', 'en');
      svc.callLogs.push({
        id: 'call-NV', studentUsn: 'USN-NV', studentName: 'X', parentId: '',
        outcome: 'NO_ANSWER', duration: 0, calledAt: new Date().toISOString(),
        institutionId: 'rvce',
      });

      await svc.finalizeCall('call-NV', 'completed');
      const log = svc.callLogs.find(c => c.id === 'call-NV')!;
      expect(log.transcript).toBeUndefined();
      expect(log.summary).toBeUndefined();
    });
  });
});
