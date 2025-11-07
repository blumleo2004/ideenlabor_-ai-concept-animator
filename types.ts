export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface AnimationGenerationResult {
  manimCode: string;
  explanationScript: string;
  initialChatMessage: string;
  videoUrl?: string; // Make videoUrl an optional part of the result
}

export enum LoadingState {
  IDLE,
  GENERATING, // Simplified single generating state
  RESPONDING_CHAT,
  DONE,
  ERROR,
}