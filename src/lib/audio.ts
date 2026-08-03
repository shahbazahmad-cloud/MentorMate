export function pcmToBase64(pcmData: Float32Array): string {
  const buffer = new ArrayBuffer(pcmData.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < pcmData.length; i++) {
    let s = Math.max(-1, Math.min(1, pcmData[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  // process in chunks to avoid max call stack size exceeded
  for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export class AudioStreamPlayer {
  private outputAudioCtx: AudioContext | null = null;
  private nextStartTime: number = 0;
  private scheduledSources: AudioBufferSourceNode[] = [];

  constructor() {
     // initialize on demand
  }
  
  init() {
     if (!this.outputAudioCtx) {
         this.outputAudioCtx = new AudioContext({ sampleRate: 24000 });
         this.nextStartTime = this.outputAudioCtx.currentTime;
     }
  }

  playAudioChunk(base64Audio: string) {
    if (!this.outputAudioCtx) return;
    
    // Resume context if suspended (needed in some browsers)
    if (this.outputAudioCtx.state === 'suspended') {
      this.outputAudioCtx.resume();
    }

    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);
    const audioBuffer = this.outputAudioCtx.createBuffer(1, pcm16.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) {
      channelData[i] = pcm16[i] / 32768.0;
    }

    const source = this.outputAudioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputAudioCtx.destination);

    if (this.nextStartTime < this.outputAudioCtx.currentTime) {
        this.nextStartTime = this.outputAudioCtx.currentTime;
    }
    source.start(this.nextStartTime);
    this.scheduledSources.push(source);
    
    source.onended = () => {
        const idx = this.scheduledSources.indexOf(source);
        if (idx !== -1) {
             this.scheduledSources.splice(idx, 1);
        }
    };

    this.nextStartTime += audioBuffer.duration;
  }
  
  stop() {
     this.scheduledSources.forEach(source => {
         try { source.stop(); } catch(e){}
     });
     this.scheduledSources = [];
     this.nextStartTime = this.outputAudioCtx ? this.outputAudioCtx.currentTime : 0;
  }
  
  close() {
      if (this.outputAudioCtx) {
         this.outputAudioCtx.close();
         this.outputAudioCtx = null;
      }
  }
}
