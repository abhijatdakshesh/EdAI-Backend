import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const CORS_ORIGINS = process.env['CORS_ORIGINS']
  ? process.env['CORS_ORIGINS'].split(',').map((s) => s.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

@Injectable()
@WebSocketGateway({
  cors: { origin: CORS_ORIGINS, credentials: true },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket): void {
    const token = (client.handshake.auth as Record<string, unknown>)?.token as string | undefined
      ?? (client.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '');

    if (!token) {
      this.logger.warn(`WS rejected — no token: ${client.id}`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<{ sub: string; institutionId?: string }>(token);
      const institutionId = payload.institutionId ?? 'default';
      client.data.institutionId = institutionId;
      void client.join(`institution:${institutionId}`);
      this.logger.log(`Client connected: ${client.id} institution=${institutionId}`);
    } catch {
      this.logger.warn(`WS rejected — invalid token: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private emitToInstitution(institutionId: string, event: string, payload: unknown): void {
    this.server.to(`institution:${institutionId}`).emit(event, payload);
  }

  emitAttendanceUpdate(payload: { classId: string; date: string; institutionId?: string }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'attendance:update', payload);
  }

  emitMarksUpdate(payload: { subjectCode: string; sem: number; institutionId?: string }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'marks:update', payload);
  }

  emitAnnouncementNew(payload: { id: string; title: string; roles: string[]; institutionId?: string }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'announcement:new', payload);
  }

  emitAiCallCompleted(payload: { callId: string; studentUsn: string; institutionId?: string }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'ai-call:completed', payload);
  }

  emitAiCallTurn(payload: {
    callId: string;
    turn: number;
    role: 'AI' | 'PARENT';
    text: string;
    language: string;
    ts: string;
    institutionId?: string;
  }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'ai-call:turn', payload);
  }

  /** Live bus GPS ping — broadcast to institution subscribers of the route. */
  emitBusLocation(payload: {
    routeId: string;
    lat: number;
    lng: number;
    speedKmph: number | null;
    recordedAt: string;
    institutionId?: string;
  }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'bus:location', payload);
  }

  emitVtuWindowOpened(payload: { windowId: string; title: string; institutionId?: string }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'vtu:window-opened', payload);
  }

  emitIaSubmissionUpdated(payload: { submissionId: string; status: string; institutionId?: string }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'ia:submission-updated', payload);
  }

  emitDocumentStatusChanged(payload: { docId: string; studentUsn: string; status: string; institutionId?: string }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'document:status-changed', payload);
  }

  /** LMS observability — no student USN in payload (DPDP). */
  emitLmsLessonMastered(payload: {
    lessonId: string;
    courseId: string;
    institutionId?: string;
  }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'lms:lesson-mastered', payload);
  }

  emitLmsCheckpointFailed(payload: {
    lessonId: string;
    courseId: string;
    institutionId?: string;
  }): void {
    this.emitToInstitution(payload.institutionId ?? 'default', 'lms:checkpoint-failed', payload);
  }
}
