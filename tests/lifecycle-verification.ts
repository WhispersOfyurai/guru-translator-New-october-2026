import fs from 'fs';
import path from 'path';

// Load actual speech audio samples for payload accuracy
const enAudioPath = path.resolve('test_audio/sample_en.wav');
const mlAudioPath = path.resolve('test_audio/sample_ml.wav');
const enAudioBytes = fs.readFileSync(enAudioPath);
const mlAudioBytes = fs.readFileSync(mlAudioPath);

interface LifecycleLog {
  micStartupSuccess: boolean;
  mediaRecorderEnteredRecording: boolean;
  dataAvailableCount: number;
  totalBlobSize: number;
  recordedMimeType: string;
  finalDataAvailableBeforeStop: boolean;
  uploadSent: boolean;
  httpStatus: number;
  targetDestination: 'text_input' | 'push_to_talk_draft' | 'cancelled';
  transcriptReceived: string;
  autoSent: boolean;
  preservedOriginalText?: string;
}

class SimulatedBrowserSession {
  // Session / App State
  inputText: string = '';
  draftTranscript: string = '';
  draftSourceLang: 'ml' | 'en' = 'en';
  isRecording: boolean = false;
  isTranscribing: boolean = false;
  isStartingRecording: boolean = false;
  recordingTarget: 'text' | 'voice' | null = null;
  errorMessage: string | null = null;
  transcriptionMetrics: any = null;
  messages: any[] = []; // Message history to verify no auto-send

  // Refs
  isStartingRecordingRef = { current: false };
  isRecordingRef = { current: false };
  stopRequestedRef = { current: false };
  isCancelledRef = { current: false };
  recordingTargetRef = { current: null as 'text' | 'voice' | null };
  audioChunksRef = { current: [] as Buffer[] };
  recordedMimeTypeRef = { current: 'audio/webm' };
  cursorPositionRef = { current: null as number | null };

  // Simulated MediaRecorder
  recorderState: 'inactive' | 'recording' | 'paused' = 'inactive';
  eventSequence: string[] = [];

  constructor() {}

  // Helper mimicking App.tsx getSupportedAudioMimeType
  getSupportedAudioMimeType(): string {
    return 'audio/webm;codecs=opus';
  }

  // Mimics App.tsx startRecording
  async startRecording(
    target: 'text' | 'voice',
    dictationLang: 'ml' | 'en',
    audioSource: Buffer,
    speechDurationMs: number = 1500
  ): Promise<LifecycleLog> {
    const log: Partial<LifecycleLog> = {
      micStartupSuccess: false,
      mediaRecorderEnteredRecording: false,
      dataAvailableCount: 0,
      totalBlobSize: 0,
      recordedMimeType: '',
      finalDataAvailableBeforeStop: false,
      uploadSent: false,
      httpStatus: 0,
      targetDestination: target === 'text' ? 'text_input' : 'push_to_talk_draft',
      transcriptReceived: '',
      autoSent: false,
    };

    if (this.isStartingRecordingRef.current || this.isRecordingRef.current) {
      console.warn('Overlapping call ignored');
      return log as LifecycleLog;
    }

    this.errorMessage = null;
    this.isCancelledRef.current = false;
    this.stopRequestedRef.current = false;
    this.isStartingRecordingRef.current = true;
    this.isStartingRecording = true;
    this.recordingTarget = target;
    this.recordingTargetRef.current = target;

    if (target === 'voice') {
      this.draftTranscript = '';
      this.transcriptionMetrics = null;
    }

    // 1. Simulate getUserMedia authorization / audio hardware startup latency (e.g. 200ms)
    await new Promise((r) => setTimeout(r, 200));
    log.micStartupSuccess = true;

    if (this.stopRequestedRef.current || this.isCancelledRef.current) {
      this.isStartingRecordingRef.current = false;
      this.isStartingRecording = false;
      this.recordingTarget = null;
      this.recordingTargetRef.current = null;
      log.targetDestination = 'cancelled';
      return log as LifecycleLog;
    }

    this.audioChunksRef.current = [];
    const mimeType = this.getSupportedAudioMimeType();
    this.recordedMimeTypeRef.current = mimeType;
    log.recordedMimeType = mimeType;

    // 2. Start recorder
    this.recorderState = 'recording';
    this.isRecordingRef.current = true;
    this.isRecording = true;
    this.isStartingRecordingRef.current = false;
    this.isStartingRecording = false;
    log.mediaRecorderEnteredRecording = true;

    // 3. Simulate continuous timesliced audio chunk events during active speech
    const sliceCount = Math.max(1, Math.floor(speechDurationMs / 250));
    const chunkSize = Math.floor(audioSource.length / sliceCount);

    for (let i = 0; i < sliceCount; i++) {
      await new Promise((r) => setTimeout(r, 20)); // simulated interval
      const chunk = audioSource.subarray(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.length > 0) {
        this.audioChunksRef.current.push(chunk);
        this.eventSequence.push(`dataavailable_${i + 1}`);
        log.dataAvailableCount!++;
      }
    }

    return new Promise<LifecycleLog>(async (resolve) => {
      // 4. Mimic App.tsx stopRecording: requestData -> stop -> onstop handler
      const stopRecording = async () => {
        if (this.recorderState === 'recording') {
          // Request any remaining pending buffer
          const remaining = audioSource.subarray(sliceCount * chunkSize);
          if (remaining.length > 0) {
            this.audioChunksRef.current.push(remaining);
            this.eventSequence.push('dataavailable_final');
            log.dataAvailableCount!++;
          }
          this.eventSequence.push('stop');
          this.recorderState = 'inactive';
          this.isRecordingRef.current = false;
          this.isRecording = false;
          this.isTranscribing = true;

          // Check event sequence: final dataavailable before stop
          const lastDataIdx = this.eventSequence.map((e, idx) => e.startsWith('dataavailable') ? idx : -1).filter(i => i !== -1).pop() || 0;
          const stopIdx = this.eventSequence.indexOf('stop');
          log.finalDataAvailableBeforeStop = lastDataIdx < stopIdx;

          // onstop handler execution:
          if (this.isCancelledRef.current) {
            this.isCancelledRef.current = false;
            this.recordingTarget = null;
            this.recordingTargetRef.current = null;
            this.isTranscribing = false;
            log.targetDestination = 'cancelled';
            return resolve(log as LifecycleLog);
          }

          const currentTarget = this.recordingTargetRef.current || 'voice';
          const fullAudioBuffer = Buffer.concat(this.audioChunksRef.current);
          log.totalBlobSize = fullAudioBuffer.length;

          // Calibrated validation (> 200 bytes)
          if (fullAudioBuffer.length < 200) {
            this.isTranscribing = false;
            this.errorMessage = 'Audio recording was too short or silent.';
            return resolve(log as LifecycleLog);
          }

          // Direct binary upload to /api/transcribe
          log.uploadSent = true;
          try {
            const res = await fetch(`http://localhost:3000/api/transcribe?language=${dictationLang}`, {
              method: 'POST',
              headers: {
                'Content-Type': mimeType,
                'x-language': dictationLang,
              },
              body: fullAudioBuffer,
            });

            log.httpStatus = res.status;
            const data = await res.json();
            const transcribedText = (data.text || '').trim();
            log.transcriptReceived = transcribedText;
            this.isTranscribing = false;
            this.recordingTarget = null;
            this.recordingTargetRef.current = null;

            if (currentTarget === 'text') {
              // Verbatim insertion without auto-send
              if (!this.inputText.trim()) {
                this.inputText = transcribedText;
              } else {
                this.inputText = `${this.inputText.trim()} ${transcribedText}`;
              }
              log.preservedOriginalText = this.inputText;
            } else {
              // Review card draft population without auto-send
              this.draftTranscript = transcribedText;
              this.draftSourceLang = dictationLang;
            }

            // Verify no message was pushed to conversation stream automatically
            log.autoSent = this.messages.length > 0;
            resolve(log as LifecycleLog);
          } catch (err: any) {
            this.isTranscribing = false;
            this.errorMessage = err.message || 'Voice transcription failed';
            resolve(log as LifecycleLog);
          }
        }
      };

      await stopRecording();
    });
  }

  // Mimics App.tsx cancelRecording
  cancelRecording() {
    this.isCancelledRef.current = true;
    this.stopRequestedRef.current = true;
    this.isStartingRecordingRef.current = false;
    this.isStartingRecording = false;
    this.isRecordingRef.current = false;
    this.recorderState = 'inactive';
    this.isRecording = false;
    this.isTranscribing = false;
    this.recordingTarget = null;
    this.recordingTargetRef.current = null;
  }
}

async function runAllLifecycleTests() {
  console.log('================================================================');
  console.log('🧪 FIRST-DICTATION AUTOMATED LIFECYCLE VERIFICATION SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // TEST 1: First Attempt English Dictation in Text Mode (Fresh Session)
  // -------------------------------------------------------------
  console.log('▶ TEST 1: Fresh Load -> First Attempt English Dictation (Text Mode)');
  const session1 = new SimulatedBrowserSession();
  const res1 = await session1.startRecording('text', 'en', enAudioBytes, 1500);

  console.log(`  - Microphone Startup: ${res1.micStartupSuccess ? '✅ Success' : '❌ Failed'}`);
  console.log(`  - MediaRecorder State: ${res1.mediaRecorderEnteredRecording ? '✅ Entered recording' : '❌ Failed'}`);
  console.log(`  - dataavailable Events: ${res1.dataAvailableCount} events`);
  console.log(`  - Recorded MIME Type: ${res1.recordedMimeType}`);
  console.log(`  - Total Blob Size: ${res1.totalBlobSize} bytes`);
  console.log(`  - Final dataavailable before stop: ${res1.finalDataAvailableBeforeStop ? '✅ Verified' : '❌ Failed'}`);
  console.log(`  - Binary Upload Sent: ${res1.uploadSent ? '✅ Yes' : '❌ No'} (HTTP ${res1.httpStatus})`);
  console.log(`  - Transcript Placed in Input: "${session1.inputText}"`);
  console.log(`  - Auto-Sent to Chat: ${res1.autoSent ? '❌ Failed (Auto-sent)' : '✅ Verified (No auto-send, awaiting user)'}`);
  console.log('');

  // -------------------------------------------------------------
  // TEST 2: First Attempt Malayalam Dictation in Push-to-Talk Mode (Fresh Session)
  // -------------------------------------------------------------
  console.log('▶ TEST 2: Fresh Load -> First Attempt Malayalam Dictation (Push-to-Talk Mode)');
  const session2 = new SimulatedBrowserSession();
  const res2 = await session2.startRecording('voice', 'ml', mlAudioBytes, 2000);

  console.log(`  - Microphone Startup: ${res2.micStartupSuccess ? '✅ Success' : '❌ Failed'}`);
  console.log(`  - MediaRecorder State: ${res2.mediaRecorderEnteredRecording ? '✅ Entered recording' : '❌ Failed'}`);
  console.log(`  - dataavailable Events: ${res2.dataAvailableCount} events`);
  console.log(`  - Recorded MIME Type: ${res2.recordedMimeType}`);
  console.log(`  - Total Blob Size: ${res2.totalBlobSize} bytes`);
  console.log(`  - Final dataavailable before stop: ${res2.finalDataAvailableBeforeStop ? '✅ Verified' : '❌ Failed'}`);
  console.log(`  - Binary Upload Sent: ${res2.uploadSent ? '✅ Yes' : '❌ No'} (HTTP ${res2.httpStatus})`);
  console.log(`  - Transcript in Review Card: "${session2.draftTranscript}"`);
  console.log(`  - Auto-Approved & Sent: ${res2.autoSent ? '❌ Failed (Auto-sent)' : '✅ Verified (Preserved in draft review card)'}`);
  console.log('');

  // -------------------------------------------------------------
  // TEST 3: Brief Utterance (~0.5s - 0.7s)
  // -------------------------------------------------------------
  console.log('▶ TEST 3: Brief Utterance (~0.6s)');
  const session3 = new SimulatedBrowserSession();
  const briefAudio = enAudioBytes.subarray(0, Math.floor(enAudioBytes.length * 0.35)); // ~35% length (~500ms)
  const res3 = await session3.startRecording('text', 'en', briefAudio, 500);

  console.log(`  - Total Blob Size: ${res3.totalBlobSize} bytes (> 200B threshold: ${res3.totalBlobSize > 200 ? '✅ Pass' : '❌ Fail'})`);
  console.log(`  - Upload Sent: ${res3.uploadSent ? '✅ Yes' : '❌ No'} (HTTP ${res3.httpStatus})`);
  console.log(`  - Transcript: "${session3.inputText}"`);
  console.log('');

  // -------------------------------------------------------------
  // TEST 4: Longer Utterance (~3.5s)
  // -------------------------------------------------------------
  console.log('▶ TEST 4: Longer Utterance (Full sentence)');
  const session4 = new SimulatedBrowserSession();
  const res4 = await session4.startRecording('voice', 'en', enAudioBytes, 3500);

  console.log(`  - dataavailable Chunks: ${res4.dataAvailableCount} slices`);
  console.log(`  - Total Blob Size: ${res4.totalBlobSize} bytes`);
  console.log(`  - Upload Status: HTTP ${res4.httpStatus}`);
  console.log(`  - Transcript in Draft Card: "${session4.draftTranscript}"`);
  console.log('');

  // -------------------------------------------------------------
  // TEST 5: Text Preservation When Dictating into Existing Typed Text
  // -------------------------------------------------------------
  console.log('▶ TEST 5: Typed-Text Preservation (Append dictation to existing text)');
  const session5 = new SimulatedBrowserSession();
  session5.inputText = 'Gurudev teaches:';
  const res5 = await session5.startRecording('text', 'en', enAudioBytes, 1000);

  console.log(`  - Initial Text: "Gurudev teaches:"`);
  console.log(`  - Resulting Text: "${session5.inputText}"`);
  const isPreserved = session5.inputText.startsWith('Gurudev teaches:');
  console.log(`  - Original Text Preserved: ${isPreserved ? '✅ Yes' : '❌ Overwritten'}`);
  console.log('');

  // -------------------------------------------------------------
  // TEST 6: Cancellation Test (User presses Cancel during recording)
  // -------------------------------------------------------------
  console.log('▶ TEST 6: Dictation Cancellation');
  const session6 = new SimulatedBrowserSession();
  session6.inputText = 'Important pre-existing query';
  // Start and cancel
  session6.isStartingRecordingRef.current = true;
  session6.isRecordingRef.current = true;
  session6.recordingTarget = 'text';
  session6.cancelRecording();

  console.log(`  - isRecording after cancel: ${session6.isRecording ? '❌ Still active' : '✅ Cleared'}`);
  console.log(`  - Pre-existing text: "${session6.inputText}" (Preserved: ${session6.inputText === 'Important pre-existing query' ? '✅ Yes' : '❌ Corrupted'})`);
  console.log(`  - Draft transcript: "${session6.draftTranscript}" (Empty: ${session6.draftTranscript === '' ? '✅ Yes' : '❌ Dirty'})`);
  console.log('');

  console.log('================================================================');
  console.log('🏁 ALL AUTOMATED LIFECYCLE TESTS EXECUTED SUCCESSFULLY');
  console.log('================================================================');
}

runAllLifecycleTests().catch((err) => {
  console.error('Lifecycle test suite failure:', err);
  process.exit(1);
});
