import { BadRequestException, ForbiddenException, Controller, Get, Post, Patch, Delete, Param, Body, Query, Request, Res, UseGuards, HttpCode, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { CommsService } from './comms.service';
import { ConsentService, ConsentChannel } from './consent.service';
import { ConversationStateService } from './conversation-state.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TwilioWebhookGuard } from '../chatbot/twilio-webhook.guard';
import { StudentPortalService } from '../student-portal/student-portal.service';

const BCP47_LANG: Record<string, string> = {
  en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN',
};
const POLLY_VOICE_EN = 'Polly.Kajal-Neural';

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Verify the HMAC-signed audio URL produced by CommsService.signAudioUrl.
 * Format: /api/comms/audio/<key>?exp=<unix-ms>&sig=<hex>
 * sig = HMAC_SHA256(`${key}:${exp}`, TWILIO_AUDIO_SIGNING_KEY)
 *
 * Returns true when:
 *   - signing key is configured (else returns false → 403 — keeps webhooks closed by default)
 *   - exp is a positive integer in the future
 *   - constant-time comparison of provided sig to computed sig succeeds
 */
function verifyAudioSignature(key: string, exp: string | undefined, sig: string | undefined): boolean {
  const signingKey = process.env['TWILIO_AUDIO_SIGNING_KEY'];
  if (!signingKey || !exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const expected = createHmac('sha256', signingKey).update(`${key}:${expNum}`).digest('hex');
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

@Controller()
@UseGuards(TwilioWebhookGuard)
class PublicCommsController {
  private readonly logger = new Logger('PublicCommsController');
  constructor(
    private readonly svc: CommsService,
    private readonly conversation: ConversationStateService,
  ) {}

  /** TwiML webhook — Twilio fetches this when call connects.
   * Returns greeting + first <Gather>. Greeting playback uses Sarvam pre-gen
   * audio (regional) or Polly.Aditi-Neural <Say> (English). */
  @ Get('comms/twiml/:callId')
  serveTwiml(@Param('callId') callId: string, @Res() res: Response) {
    const baseUrl = process.env['TWILIO_WEBHOOK_BASE_URL'] ?? process.env['APP_URL'] ?? 'http://localhost:3001';
    const state = this.conversation.get(callId);
    const language = state?.language ?? 'en';
    const langTag = BCP47_LANG[language] ?? 'en-IN';
    this.logger.log(`[TwiML] callId=${callId} stateFound=${!!state} language=${language} baseUrl=${baseUrl}`);

    let speakXml: string;
    if (language === 'en') {
      const greeting = state?.turns?.[0]?.text ?? 'Hello, this is EdAI calling from RVCE.';
      speakXml = `<Say voice="${POLLY_VOICE_EN}" language="en-IN">${escXml(greeting)}</Say>`;
    } else {
      // Regional: greeting audio cached under the bare callId, fetched via signed URL
      const playUrl = this.svc.signAudioUrl(callId, baseUrl);
      this.logger.log(`[TwiML] playUrl=${playUrl}`);
      speakXml = `<Play>${escXml(playUrl)}</Play>`;
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>${speakXml}` +
      `<Gather input="speech" speechTimeout="auto" timeout="6" language="${langTag}" ` +
      `action="${baseUrl}/api/comms/twiml/${callId}/turn" method="POST"></Gather></Response>`;

    res.type('text/xml');
    res.send(xml);
  }

  /** Per-turn webhook — Twilio posts SpeechResult here after each <Gather>. */
  @ Post('comms/twiml/:callId/turn')
  async serveTurn(
    @Param('callId') callId: string,
    @Body() body: { SpeechResult?: string; CallStatus?: string; Digits?: string },
    @Res() res: Response,
  ) {
    const speech = body?.SpeechResult ?? body?.Digits ?? '';
    const xml = await this.svc.handleTurn(callId, speech, body?.CallStatus);
    res.type('text/xml');
    res.send(xml);
  }

  /** Twilio status callback — fires on completed/failed/no-answer/busy. */
  @ Post('comms/twiml/:callId/status')
  @ HttpCode(204)
  async serveStatusCallback(
    @Param('callId') callId: string,
    @Body() body: { CallStatus?: string },
  ) {
    const status = body?.CallStatus;
    if (status && ['completed', 'failed', 'no-answer', 'busy'].includes(status)) {
      await this.svc.finalizeCall(callId, status);
    }
  }

  /** Twilio <Dial> action callback for AI→human transfer. DialCallStatus is the
   * outcome of the agent leg (completed/no-answer/busy/failed). */
  @ Post('comms/twiml/:callId/transfer-result')
  async serveTransferResult(
    @Param('callId') callId: string,
    @Body() body: { DialCallStatus?: string; DialCallDuration?: string },
    @Res() res: Response,
  ) {
    const duration = body?.DialCallDuration ? Number(body.DialCallDuration) : undefined;
    const xml = await this.svc.finalizeTransfer(callId, body?.DialCallStatus, duration);
    res.type('text/xml');
    res.send(xml);
  }

}

export { PublicCommsController };

/** Unguarded controller — Twilio <Play> fetches audio without X-Twilio-Signature.
 * HMAC via verifyAudioSignature() (short-lived signed URL) is the sole auth gate. */
@Controller()
class AudioController {
  private readonly logger = new Logger('AudioController');
  constructor(private readonly svc: CommsService) {}

  /** If the signing key is unset, all requests fail closed (403). */
  @ Get('comms/audio/:key')
  serveAudio(
    @Param('key') key: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    const sigOk = verifyAudioSignature(key, exp, sig);
    this.logger.log(`[Audio] key=${key} exp=${exp} sigOk=${sigOk} signingKeySet=${!!process.env['TWILIO_AUDIO_SIGNING_KEY']}`);
    if (!sigOk) {
      this.logger.warn(`[Audio] 403 key=${key} exp=${exp} sig=${sig?.slice(0, 8)}`);
      res.status(403).send('Invalid or expired audio signature');
      return;
    }
    const buf = this.svc.getAudio(key);
    this.logger.log(`[Audio] key=${key} bufLen=${buf?.length ?? 'NOT_FOUND'}`);
    if (!buf) { res.status(404).send('Audio not found'); return; }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  }
}

export { AudioController };

@UseGuards(JwtAuthGuard)
@Controller()
export class CommsController {
  constructor(
    private readonly svc: CommsService,
    private readonly consentSvc: ConsentService,
    private readonly studentPortalSvc: StudentPortalService,
  ) {}

  @ Get('comms/announcements')
  getAnnouncements(@Request() req: any) {
    const institutionId: string = req.user?.institutionId ?? process.env.INSTITUTION_ID;
    if (!institutionId) throw new BadRequestException('institutionId not resolvable from token');
    return this.svc.getAnnouncements(institutionId);
  }

  @ Get('comms/calls')
  getCallsByClass(@Query('classId') classId: string, @Request() req: any) {
    if (!classId) throw new BadRequestException('classId is required');
    const institutionId: string = req.user?.institutionId ?? process.env.INSTITUTION_ID;
    if (!institutionId) throw new BadRequestException('institutionId not resolvable from token');
    return this.svc.getCallsByClass(classId, institutionId);
  }

  @ Get('comms/calls/recent')
  getRecentCalls() {
    return this.svc.getRecentCalls();
  }

  @ Get('parent-comms/calls')
  getParentCalls(@Request() req: any) {
    // Use token sub — parentId from query string is an IDOR vector
    const parentId: string = req.user?.sub ?? 'unknown';
    const institutionId: string = req.user?.institutionId ?? process.env['INSTITUTION_ID'];
    return this.svc.getParentCalls(parentId, institutionId);
  }

  @ Get('parent-comms/messages')
  getParentMessages(@Request() req: any) {
    const parentId: string = req.user?.sub ?? 'unknown';
    return this.svc.getParentMessages(parentId);
  }

  @ Get('admin/calls/logs')
  getAdminCallLogs(@Request() req: any) {
    const institutionId: string = req.user?.institutionId ?? process.env['INSTITUTION_ID'];
    return this.svc.getAdminCallLogs(institutionId);
  }

  @ Post('comms/calls/trigger')
  async triggerCall(@Body() body: { studentUsn: string; type: string; language?: string }) {
    return this.svc.triggerCall(body.studentUsn, body.type, 'rvce', body.language ?? 'en');
  }

  @ Post('comms/sms/send')
  sendSms(@Body() body: { phone: string; message: string }) {
    return this.svc.sendSms(body.phone, body.message);
  }

  @ Post('comms/announcements')
  createAnnouncement(
    @Body() body: { title: string; content: string; audience: string },
    @Request() req: any,
  ) {
    const institutionId: string = req.user?.institutionId ?? process.env.INSTITUTION_ID ?? 'default';
    return this.svc.createAnnouncement(body.title, body.content, body.audience, institutionId);
  }

  @ Post('parent-comms/calls/trigger')
  triggerParentCall(@Body() body: { parentId: string; studentUsn: string; type: string }, @Request() req: any) {
    // Admins/principals/etc may trigger calls on behalf of any parent. Parents themselves
    // can only trigger their own calls (sub must match parentId).
    const role = req.user?.role;
    const authenticatedUserId = req.user?.sub;
    const isStaff = role === 'ADMIN' || role === 'PRINCIPAL' || role === 'DEAN' || role === 'COUNSELLOR';
    if (!isStaff && authenticatedUserId && authenticatedUserId !== body.parentId) {
      throw new ForbiddenException('Cannot trigger calls for another parent');
    }
    return this.svc.triggerParentCall(body.parentId, body.studentUsn, body.type);
  }

  @ Get('parent-comms/notifications')
  getNotifications(@Request() req: any) {
    const parentId = req.user?.sub ?? 'unknown';
    return this.svc.getNotifications(parentId);
  }

  // IMPORTANT: read-all MUST be before :id/read to avoid routing conflict
  @ Patch('parent-comms/notifications/read-all')
  markAllRead(@Request() req: any) {
    const parentId = req.user?.sub ?? 'unknown';
    return this.svc.markAllRead(parentId);
  }

  @ Patch('parent-comms/notifications/:id/read')
  markRead(@Param('id') id: string) {
    return this.svc.markNotificationRead(id);
  }

  // ─── DPDP Consent endpoints ────────────────────────────────────────────────

  /** Grant consent for one or more channels. Called during parent/student onboarding. */
  @ Post('consent/grant')
  grantConsent(
    @Body() body: { channels: ConsentChannel[] },
    @Request() req: any,
  ) {
    const principalId: string = req.user?.sub ?? 'unknown';
    const institutionId: string = req.user?.institutionId ?? process.env['INSTITUTION_ID'] ?? 'default';
    return this.consentSvc.grant(principalId, body.channels, institutionId);
  }

  /** Revoke specific channels. DPDP requires revocation to be honoured immediately. */
  @ Post('consent/revoke')
  revokeConsent(
    @Body() body: { channels: ConsentChannel[] },
    @Request() req: any,
  ) {
    const principalId: string = req.user?.sub ?? 'unknown';
    const institutionId: string = req.user?.institutionId ?? process.env['INSTITUTION_ID'] ?? 'default';
    this.consentSvc.revoke(principalId, body.channels, institutionId);
    return { ok: true };
  }

  /** Revoke all consent — data principal right under DPDP Act 2023. */
  @ Delete('consent')
  revokeAllConsent(@Request() req: any) {
    const principalId: string = req.user?.sub ?? 'unknown';
    const institutionId: string = req.user?.institutionId ?? process.env['INSTITUTION_ID'] ?? 'default';
    this.consentSvc.revokeAll(principalId, institutionId);
    return { ok: true };
  }

  /** Get current consent status for the authenticated principal. */
  @ Get('consent')
  getConsent(@Request() req: any) {
    const principalId: string = req.user?.sub ?? 'unknown';
    const institutionId: string = req.user?.institutionId ?? process.env['INSTITUTION_ID'] ?? 'default';
    return this.consentSvc.getConsent(principalId, institutionId) ?? { active: false, channels: [] };
  }
}
