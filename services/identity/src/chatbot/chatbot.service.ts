// DPDP_DATA_RESIDENCY_WARNING: Anthropic Claude API processes data on Anthropic-hosted servers.
// All calls include a DPDP consent check; minimal PII is included in prompts.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { getGeminiClient, GEMINI_FAST, GEMINI_SMART, modelChain, withGeminiRetry } from '../shared/gemini-ai';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { KnowledgeGraph, StudentKnowledgeGraph, ParentKnowledgeGraph, TeacherKnowledgeGraph, AdminKnowledgeGraph, RecruiterKnowledgeGraph } from './knowledge-graph.service';

const LANGUAGE_NAMES: Record<string, string> = {
  kn: 'Kannada', ta: 'Tamil', te: 'Telugu', hi: 'Hindi', en: 'English',
};

// Keyword-based model routing — no extra API call (Sujit: unit economics)
const SIMPLE_PATTERNS = ['schedule', 'today', 'tomorrow', 'fee', 'balance', 'paid', 'attendance', 'percentage', 'class', 'timetable', 'room', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'vtu', 'exam', 'eligible'];

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private get gemini() { return getGeminiClient(); }

  constructor(
    @Optional() @InjectDataSource() private readonly db: DataSource | null,
  ) {}

  selectModel(message: string): string {
    const lower = message.toLowerCase();
    return SIMPLE_PATTERNS.some(p => lower.includes(p)) ? GEMINI_FAST : GEMINI_SMART;
  }

  private getLang(graph: KnowledgeGraph): string {
    const lang = graph.preferredLanguage;
    return LANGUAGE_NAMES[lang] ?? 'English';
  }

  buildSystemPrompt(graph: KnowledgeGraph): string {
    const langName = this.getLang(graph);
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const roleIntro = graph.role === 'STUDENT'
      ? `You are EdAI, a friendly academic assistant at ${(graph as StudentKnowledgeGraph).collegeName}. You are talking to ${(graph as StudentKnowledgeGraph).name} (USN: ${(graph as StudentKnowledgeGraph).usn}), Semester ${(graph as StudentKnowledgeGraph).semester}, Section ${(graph as StudentKnowledgeGraph).section}, ${(graph as StudentKnowledgeGraph).department}.`
      : graph.role === 'PARENT'
      ? `You are EdAI, a trusted academic companion for parents at RV College of Engineering, Bengaluru. You are talking to the parent of ${(graph as ParentKnowledgeGraph).child.name} (USN: ${(graph as ParentKnowledgeGraph).child.usn}).`
      : graph.role === 'ADMIN'
      ? `You are EdAI, an institutional intelligence assistant at ${(graph as AdminKnowledgeGraph).collegeName}. You are talking to ${(graph as AdminKnowledgeGraph).name}, an administrator. You have full visibility into: today's & weekly campus class schedule (todaySchedule, weekSchedule), student performance, risk scores (atRiskStudents), fee collection (feeCollectionSummary), exam windows (examWindow), placements, and announcements. When asked "my schedule", show today's college-wide class schedule.`
      : graph.role === 'RECRUITER'
      ? `You are EdAI, a recruiter intelligence assistant connecting employers to Indian engineering colleges. You are talking to ${(graph as RecruiterKnowledgeGraph).name}, a campus recruiter. You have visibility into their recently posted jobs (recentJobs), aggregate hiring funnel (totalApplicants, totalShortlisted, totalOffersMade), and partner colleges. Help them analyse their pipeline, suggest next actions (e.g. "shortlist top 10 by CGPA"), and answer questions like "how many applicants for X role?", "best college for Java hires?", "convert rate from applied to offered?".`
      : `You are EdAI, a professional assistant for faculty at RV College of Engineering, Bengaluru. You are talking to ${(graph as TeacherKnowledgeGraph).name} from the ${(graph as TeacherKnowledgeGraph).department} department.`;

    return `${roleIntro}

RULES:
1. Answer ONLY from the knowledge graph below. Never invent data.
2. If data is missing or empty, say "I don't have that information right now."
3. Always respond in ${langName}.
4. Keep responses concise — 2-4 sentences unless a list is needed.
5. For attendance: clearly state whether safe (≥75%) or at risk (<75%).
6. Never mention "knowledge graph" or "context" — just answer naturally.
7. Today is ${today}.
8. weekSchedule keys are MON/TUE/WED/THU/FRI/SAT — use these to answer "tomorrow" or day-specific questions.
9. For VTU: vtuEligibility shows exam eligibility and registration status per subject.
10. feeBreakdown shows individual fee components (tuition, hostel, lab etc.) with amounts and due dates.
11. alumniStats shows average and max placement packages by department — use for placement context.
12. upcomingPlacements includes eligibleDepts — check if student's department is eligible before confirming eligibility.

KNOWLEDGE GRAPH:
${JSON.stringify(graph, null, 2)}`;
  }

  async chatStream(
    conversationId: string,
    userMessage: string,
    graph: KnowledgeGraph,
    onChunk: (text: string) => void,
  ): Promise<string> {
    // Load last 10 messages — tolerate missing chat_messages table on
    // partially-migrated environments. Empty history is acceptable.
    const history = this.db
      ? (await this.db.query(
          `SELECT role, content FROM chat_messages
           WHERE conversation_id = $1 AND role IN ('USER','ASSISTANT')
           ORDER BY created_at ASC
           OFFSET GREATEST(0, (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = $1 AND role IN ('USER','ASSISTANT')) - 10)`,
          [conversationId],
        ).catch(() => [])) as Array<{ role: string; content: string }>
      : [];

    // Save user message — best-effort; never block the reply on a write failure.
    if (this.db) {
      await this.db.query(
        `INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1, 'USER', $2)`,
        [conversationId, userMessage],
      ).catch((err) => {
        this.logger.warn(`chat_messages insert failed (will still reply): ${(err as Error).message}`);
      });
    }

    const selectedModel = this.selectModel(userMessage);
    let fullText = '';
    let tokensUsed = 0;

    // Build Gemini message history (user/model roles)
    const geminiContents = [
      ...history.map(h => ({
        role: (h.role === 'USER' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: h.content }],
      })),
      { role: 'user' as const, parts: [{ text: userMessage }] },
    ];

    const systemInstruction = this.buildSystemPrompt(graph);

    // withGeminiRetry walks the model chain and retries transient 429/503 with
    // backoff, so neither a rate limit nor one model's zero allowance takes chat
    // down. Free-tier keys throttle after a handful of calls in a minute.
    let modelUsed = selectedModel;

    // Chunks are forwarded to the client as they arrive, so once the first one
    // is out we are committed to that attempt: a retry would append a second
    // answer to a half-written one. Failures before any output are still safe
    // to retry, which covers the 429s and model-unavailable errors that this
    // was built for — those come back from the initial call, not mid-stream.
    let emitted = false;

    try {
      const { text, tokens, model } = await withGeminiRetry(selectedModel, async (candidate) => {
        if (emitted) throw new Error('Gemini stream already partially delivered — not retrying');

        const stream = await this.gemini.models.generateContentStream({
          model: candidate,
          contents: geminiContents,
          config: {
            // Gemini charges "thinking" tokens against maxOutputTokens, and the
            // amount is unpredictable — 702 thinking tokens for a 7-token answer
            // was measured, versus 32 for a far larger prompt. At the previous
            // 1024 cap a long think left nothing for the reply, so the model
            // returned STOP with no text parts and the user saw "I'm having
            // trouble right now" on some turns and a correct answer on others.
            //
            // Every answer here is extracted from the knowledge graph in the
            // system prompt, so there is nothing to reason about.
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 2048,
            systemInstruction,
          },
        });

        let buffered = '';
        let lastUsage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
        for await (const chunk of stream) {
          const text = chunk.text ?? '';
          if (text) {
            buffered += text;
            emitted = true;
            onChunk(text);
          }
          if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;
        }

        return {
          text: buffered,
          tokens: (lastUsage?.promptTokenCount ?? 0) + (lastUsage?.candidatesTokenCount ?? 0),
          model: candidate,
        };
      });

      if (model !== selectedModel) {
        this.logger.warn(`Gemini fell back from ${selectedModel} to ${model}`);
      }
      fullText = text;
      tokensUsed = tokens;
      modelUsed = model;
    } catch (err) {
      this.logger.error(`Gemini chat error (tried ${modelChain(selectedModel).join(', ')})`, err);
      fullText = "I'm having trouble right now. Please try again in a moment.";
      onChunk(fullText);
    }

    // Save assistant response — best-effort. Reply already streamed; persistence
    // failures must not surface to the user.
    if (this.db) {
      await this.db.query(
        `INSERT INTO chat_messages (conversation_id, role, content, tokens_used, model_used)
         VALUES ($1, 'ASSISTANT', $2, $3, $4)`,
        [conversationId, fullText, tokensUsed, modelUsed],
      ).catch(() => undefined);

      await this.db.query(
        `UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`,
        [conversationId],
      ).catch(() => undefined);
    }

    return fullText;
  }

  async getOrCreateConversation(
    userIdentifier: string,
    userRole: string,
    channel: 'WEB' | 'WHATSAPP',
    language = 'en',
  ): Promise<string> {
    // Synthetic ID lets the chat work even when chat_conversations table is
    // missing (partial migrations) — history just won't persist.
    const synthetic = () => `eph-${userIdentifier}-${Date.now()}`;
    if (!this.db) return synthetic();

    try {
      const existing = await this.db.query(
        `SELECT id FROM chat_conversations
         WHERE user_identifier = $1 AND channel = $2 AND is_active = true
           AND last_message_at > now() - INTERVAL '2 hours'
         ORDER BY last_message_at DESC LIMIT 1`,
        [userIdentifier, channel],
      ) as Array<{ id: string }>;

      if (existing[0]) return existing[0].id;

      await this.db.query(
        `UPDATE chat_conversations SET is_active = false
         WHERE user_identifier = $1 AND channel = $2 AND is_active = true`,
        [userIdentifier, channel],
      );

      const created = await this.db.query(
        `INSERT INTO chat_conversations (user_identifier, user_role, channel, language)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userIdentifier, userRole, channel, language],
      ) as Array<{ id: string }>;

      return created[0].id;
    } catch (err) {
      this.logger.warn(`chat_conversations unavailable, using ephemeral ID: ${(err as Error).message}`);
      return synthetic();
    }
  }

  async recordConsent(conversationId: string): Promise<void> {
    if (!this.db) return;
    await this.db.query(
      `UPDATE chat_conversations SET chatbot_consent_at = now() WHERE id = $1 AND chatbot_consent_at IS NULL`,
      [conversationId],
    );
  }

  async getHistory(conversationId: string, userId: string): Promise<Array<{ role: string; content: string; createdAt: string }>> {
    if (!this.db) return [];
    return this.db.query(
      `SELECT cm.role, cm.content, cm.created_at AS "createdAt"
       FROM chat_messages cm
       JOIN chat_conversations cc ON cc.id = cm.conversation_id
       WHERE cm.conversation_id = $1 AND cc.user_identifier = $2
         AND cm.role IN ('USER','ASSISTANT')
       ORDER BY cm.created_at ASC LIMIT 50`,
      [conversationId, userId],
    ) as Promise<Array<{ role: string; content: string; createdAt: string }>>;
  }

  async getSessions(): Promise<unknown[]> {
    if (!this.db) return [];
    // Tolerate partially-migrated environments where chat_conversations does
    // not yet exist. Returning [] keeps the admin dashboard from 500ing.
    try {
      return await (this.db.query(
        `SELECT id, user_identifier, user_role, channel, language, is_active, created_at, last_message_at
         FROM chat_conversations ORDER BY last_message_at DESC LIMIT 100`,
      ) as Promise<unknown[]>);
    } catch (err) {
      this.logger.warn(`chat_conversations query failed (returning empty list): ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Public (pre-login) Q&A about the college. No DB, no PII, no conversation
   * persistence. Single-shot Gemini call with a tight system prompt that
   * limits answers to institutional information only.
   */
  async askPublic(userMessage: string): Promise<string> {
    const systemInstruction = `You are EdAI, the public assistant on the EdAI / RV College of Engineering website.
You are talking to an anonymous visitor who has NOT logged in.

WHAT YOU CAN ANSWER:
- General college information: programs offered (B.E., M.Tech, MBA, MCA), departments (CSE, ECE, EEE, ME, CV, IS, Biotech, IEM, ETE, Aerospace), affiliation (VTU), accreditation (NAAC A+, NBA), location (Mysuru Road, Bengaluru-560059).
- Admissions process at a high level: VTU CET / COMEDK / Management quota. Direct visitors to https://rvce.edu.in/admissions for specifics.
- Placement reputation (top recruiters: Google, Microsoft, Amazon, Goldman Sachs, etc.) at a high level.
- Campus facilities, hostels, libraries, sports, clubs at a general level.
- How to use EdAI as a student/parent/faculty after they log in.

WHAT YOU MUST REFUSE:
- ANY question about a specific student's attendance, marks, fees, schedule, or personal data.
- ANY question requiring a USN, employee ID, or login.
- If asked for personal data, reply: "Please log in to your EdAI account to see your personal academic information."

STYLE:
- Friendly, concise (2-4 sentences).
- If unsure, say "Please visit https://rvce.edu.in or contact the admissions office for the latest details."
- Never invent specific numbers (cut-offs, fees, ranks). If asked, redirect to the official website.
- Always respond in English unless the visitor writes in another language.`;

    try {
      const res = await this.gemini.models.generateContent({
        model: GEMINI_FAST,
        contents: userMessage,
        // thinkingBudget 0 for the same reason as chatStream: thinking tokens
        // come out of maxOutputTokens, and 512 is small enough that a single
        // long think returns an empty answer.
        config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 512, systemInstruction },
      });
      return (res.text ?? '').trim() || "I'm not sure about that. Please visit https://rvce.edu.in for details.";
    } catch (err) {
      this.logger.error('Public chatbot error', err);
      return "I'm having trouble right now. Please try again in a moment, or visit https://rvce.edu.in.";
    }
  }
}
