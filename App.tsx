import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Chat } from "@google/genai";
import type { ChatMessage, AnimationGenerationResult } from './types';
import { LoadingState } from './types';
import { generateAnimationFromPrompt } from './services/geminiService';
import { PlayIcon, PauseIcon, LoadingSpinner, UploadIcon, CloseIcon, CopyIcon, CheckIcon } from './components/icons';

// The audio decoding and Manim rendering functions are no longer needed here,
// as this logic is now handled by the backend and the new geminiService.
// We can remove them for a cleaner App.tsx.

const App: React.FC = () => {
    const [prompt, setPrompt] = useState<string>('Visualize the dot product of two vectors, v=[2,1] and w=[1,3]');
    const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
    const [error, setError] = useState<string | null>(null);
    
    const [uploadedImage, setUploadedImage] = useState<{ base64: string; mimeType: string; } | null>(null);

    const [animationData, setAnimationData] = useState<AnimationGenerationResult | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    // Audio state is also removed for now, as the backend doesn't generate it yet.
    // const [audioUrl, setAudioUrl] = useState<string | null>(null);

    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState<string>('');
    const chatRef = useRef<Chat | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isCopied, setIsCopied] = useState<boolean>(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [generationProgress, setGenerationProgress] = useState<number>(0); // 0-100
    const progressTimerRef = useRef<number | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    
    // Setup Chat instance when animation data is available
    useEffect(() => {
        if (animationData && !chatRef.current) {
            // Access the API key using Vite's import.meta.env syntax
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
            if (!apiKey) {
                setError("VITE_GEMINI_API_KEY is not set. Please add it to your .env file for the chat feature.");
                return;
            }
            const ai = new GoogleGenAI({ apiKey });
            chatRef.current = ai.chats.create({
                model: 'gemini-1.5-flash-latest', // Updated model
                config: {
                    systemInstruction: `You are a helpful assistant explaining a Manim animation about linear algebra. The user has just generated an animation with the following script:\n\n${animationData.manimCode}\n\nAnd the following explanation:\n\n${animationData.explanationScript}\n\nKeep your answers concise and focused on the user's questions.`,
                },
            });
        }
    }, [animationData]);
    
    // The audio-related useEffect is no longer needed.
    // We can add it back when we implement audio generation on the backend.

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim()) {
            setError("Please enter a prompt.");
            return;
        }
        setError(null);
        setLoadingState(LoadingState.GENERATING); // Use the simplified loading state
        setAnimationData(null);
        setVideoUrl(null);
        // setAudioUrl(null);
        setChatHistory([]);
        chatRef.current = null;

        try {
            // All generation logic is now in a single call to our backend.
            // Reset progress and start simulation
            setGenerationProgress(0);
            if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
            progressTimerRef.current = window.setInterval(() => {
                setGenerationProgress(prev => {
                    // slow growth, cap at 92% until finished
                    const next = prev + Math.random() * 6;
                    return Math.min(92, Math.round(next));
                });
            }, 900);
            // create abort controller for this request
            if (abortControllerRef.current) {
                try { abortControllerRef.current.abort(); } catch {}
            }
            abortControllerRef.current = new AbortController();
            const result = await generateAnimationFromPrompt(prompt, abortControllerRef.current.signal);
            // generation finished -> jump progress to 100 briefly
            setGenerationProgress(100);
            if (progressTimerRef.current) { window.clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
            setTimeout(() => setGenerationProgress(0), 600);
            
            setAnimationData(result);
            setVideoUrl(result.videoUrl); // The backend provides the full, correct URL
            setChatHistory([{ role: 'model', text: result.initialChatMessage }]);

            // We can re-add audio generation here if the backend supports it in the future.

            setLoadingState(LoadingState.DONE);

        } catch (err: any) {
            setError(err.message || "An unknown error occurred.");
            setLoadingState(LoadingState.ERROR);
        }
    }, [prompt, uploadedImage]);

    const handleCancel = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        if (progressTimerRef.current) {
            window.clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
        }
        setGenerationProgress(0);
        setLoadingState(LoadingState.IDLE);
        setError('Generation cancelled.');
    }, []);

    // Keyboard shortcut for fullscreen and cleanup for progress timer
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'f') {
                const el = videoRef.current as any;
                if (!el) return;
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else if (el.requestFullscreen) {
                    el.requestFullscreen();
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            if (progressTimerRef.current) {
                window.clearInterval(progressTimerRef.current);
                progressTimerRef.current = null;
            }
        };
    }, []);
    
    const handleChatSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatInput.trim() || !chatRef.current) return;

        const userMessage: ChatMessage = { role: 'user', text: chatInput };
        setChatHistory(prev => [...prev, userMessage]);
        setChatInput('');
        setLoadingState(LoadingState.RESPONDING_CHAT);

        try {
            // This still uses a direct API call for the interactive chat part.
            // This is fine for now, but could also be moved to the backend later.
            const response = await chatRef.current.sendMessage({ message: userMessage.text });
            const modelMessage: ChatMessage = { role: 'model', text: response.text };
            setChatHistory(prev => [...prev, modelMessage]);
        } catch (err: any) {
            setError("Failed to get chat response.");
            setChatHistory(prev => [...prev, {role: 'model', text: 'Sorry, I encountered an error.'}]);
        } finally {
            setLoadingState(LoadingState.DONE);
        }
    }, [chatInput]);

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]);
            };
            reader.onerror = error => reject(error);
        });
    };
    
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await fileToBase64(file);
                setUploadedImage({ base64, mimeType: file.type });
            } catch (error) {
                setError("Failed to read image file.");
                console.error(error);
            }
        }
    };

    // togglePlayPause is no longer needed without audio.

    const handleCopyCode = useCallback(() => {
        if (!animationData?.manimCode) return;
        navigator.clipboard.writeText(animationData.manimCode).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        }).catch(err => {
            console.error("Failed to copy code: ", err);
            setError("Could not copy code to clipboard.");
        });
    }, [animationData]);

    const loadingMessages: { [key in LoadingState]?: string } = {
        [LoadingState.GENERATING]: 'Generating animation, script, and video... (this can take a minute)',
        [LoadingState.RESPONDING_CHAT]: 'Thinking...',
    };
    
    return (
        <div className="min-h-screen bg-white text-gray-900 font-sans flex flex-col p-4 md:p-8">
            <header className="flex justify-between items-center w-full">
                <div className="flex items-center gap-4">
                    <div className="bg-brand-blue text-white font-bold text-lg w-10 h-10 flex items-center justify-center">
                        EM
                    </div>
                    <span className="font-semibold text-lg">EASY MANIM</span>
                </div>
                <nav className="hidden md:flex items-center gap-8 text-gray-600">
                    <a href="#" className="hover:text-brand-blue transition-colors">Services</a>
                    <a href="#" className="hover:text-brand-blue transition-colors">Methoden</a>
                    <a href="#" className="hover:text-brand-blue transition-colors">Team</a>
                    <a href="#" className="hover:text-brand-blue transition-colors">Projekte</a>
                </nav>
            </header>

            <main className="flex-grow flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 py-8 md:py-16">
                {/* Left Side: Title & Inputs */}
                <div className="w-full md:w-1/2 flex flex-col gap-6">
                    <h1 className="text-5xl md:text-7xl font-black text-brand-blue leading-tight tracking-tighter">
                        EASY<br/>MANIM
                    </h1>
                    <p className="text-gray-600 max-w-md">
                        Visualize complex concepts with AI. Enter a prompt, and get a Manim animation script, an audio explanation, and an interactive learning chat.
                    </p>
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g., Visualize the dot product of two vectors"
                        className="w-full p-4 bg-gray-800 text-white border-2 border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition placeholder-gray-400"
                        rows={3}
                        aria-label="Concept to visualize"
                    />
                     <div className="flex items-center gap-4 flex-wrap">
                        <label htmlFor="image-upload" className="cursor-pointer flex items-center gap-2 px-4 py-2 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition">
                            <UploadIcon className="w-5 h-5 text-gray-500" />
                            <span>{uploadedImage ? 'Image Selected' : 'Upload Image'}</span>
                        </label>
                        <input id="image-upload" type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                        {uploadedImage && (
                             <button onClick={() => setUploadedImage(null)} className="p-2 text-gray-500 hover:text-red-500" aria-label="Remove uploaded image">
                                 <CloseIcon className="w-6 h-6" />
                             </button>
                        )}
                        {loadingState === LoadingState.GENERATING ? (
                            <div className="ml-auto flex items-center gap-3">
                                <button onClick={handleCancel} className="bg-red-500 text-white font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition flex items-center gap-2">Cancel</button>
                                <div className="text-sm text-gray-600">Estimated: ~1-2 min</div>
                            </div>
                        ) : (
                            <button
                                onClick={handleGenerate}
                                disabled={loadingState === LoadingState.RESPONDING_CHAT}
                                className="ml-auto bg-brand-blue text-white font-semibold px-8 py-3 rounded-lg hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {loadingState === LoadingState.RESPONDING_CHAT ? (
                                    <LoadingSpinner className="w-5 h-5"/>
                                ) : (
                                    'Generate'
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {/* Right Side: Visuals */}
                <div className="w-full md:w-1/2 h-96 relative flex items-center justify-center">
                    {/* Abstract Shapes */}
                    <div className="absolute w-64 h-64 bg-brand-beige rounded-full z-0"></div>
                    <div className="absolute bottom-0 right-10 w-48 h-24 bg-brand-blue z-10"></div>
                    <div className="absolute top-0 right-0 w-8 h-48 bg-brand-green transform -rotate-45 origin-top-right z-0"></div>
                    <div className="absolute w-64 h-64 border-2 border-blue-200 rounded-full z-0 transform translate-x-4 -translate-y-4"></div>
                    
                        <div className="w-full max-w-3xl bg-white/60 backdrop-blur-sm rounded-lg shadow-lg z-20 flex flex-col items-stretch justify-center overflow-hidden text-center p-2 md:p-4">
                            {/* Player area */}
                            <div className="relative w-full md:h-96 h-64 bg-black rounded-md overflow-hidden flex items-center justify-center">
                                {loadingState === LoadingState.GENERATING ? (
                                    <>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                                            <LoadingSpinner className="w-14 h-14 text-brand-blue mx-auto mb-4" />
                                            <p className="text-sm text-gray-200 mb-3">{loadingMessages[loadingState]}</p>
                                            {/* progress bar */}
                                            <div className="w-56 md:w-80 bg-gray-700/40 rounded-full h-3 overflow-hidden">
                                                <div className="bg-brand-blue h-3 transition-all" style={{ width: `${generationProgress}%` }} />
                                            </div>
                                            <div className="text-xs text-gray-300 mt-2">{generationProgress > 0 ? `${generationProgress}%` : 'Starting...'}</div>
                                        </div>
                                    </>
                                ) : videoUrl ? (
                                    <>
                                        <video ref={el => videoRef.current = el} src={videoUrl} controls className="w-full h-full object-contain bg-black" />
                                        {/* overlay controls */}
                                        <div className="absolute top-3 right-3 flex gap-2">
                                            <button
                                                aria-label="Fullscreen"
                                                onClick={() => {
                                                    const el = videoRef.current as any;
                                                    if (!el) return;
                                                    if (document.fullscreenElement) {
                                                        document.exitFullscreen();
                                                    } else if (el.requestFullscreen) {
                                                        el.requestFullscreen();
                                                    } else if (el.webkitRequestFullscreen) {
                                                        (el as any).webkitRequestFullscreen();
                                                    }
                                                }}
                                                className="bg-black/50 text-white px-3 py-1 rounded-md text-sm hover:bg-black/70"
                                            >
                                                Fullscreen
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-gray-400">Your visualization will appear here</div>
                                )}
                            </div>
                            {/* small caption / controls area */}
                            <div className="mt-3 px-2 md:px-4 flex items-center justify-between">
                                <div className="text-sm text-gray-600">Preview</div>
                                {videoUrl && (
                                    <div className="text-sm text-gray-600">Tip: press <kbd className="px-1 py-0.5 bg-gray-200 rounded">F</kbd> for fullscreen</div>
                                )}
                            </div>
                        </div>
                </div>
            </main>
            
             {/* Results Section */}
            {animationData && (
                <section className="w-full mt-8 md:mt-16 p-4 md:p-8 bg-gray-50 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Left: Code & Audio */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h2 className="text-2xl font-bold">Manim Script</h2>
                                <button 
                                    onClick={handleCopyCode} 
                                    className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-all disabled:opacity-50"
                                    disabled={!animationData?.manimCode}
                                >
                                    {isCopied ? (
                                        <>
                                            <CheckIcon className="w-4 h-4 text-green-600" />
                                            <span>Copied!</span>
                                        </>
                                    ) : (
                                        <>
                                            <CopyIcon className="w-4 h-4" />
                                            <span>Copy</span>
                                        </>
                                    )}
                                </button>
                            </div>
                             <pre className="bg-gray-800 text-white p-4 rounded-lg overflow-x-auto max-h-96">
                                <code>{animationData.manimCode}</code>
                            </pre>
                            
                            {/* The audio player section is removed for now. */}
                        </div>

                        {/* Right: Chat */}
                        <div>
                             <h2 className="text-2xl font-bold mb-4">Interactive Chat</h2>
                             <div className="bg-white p-4 rounded-lg shadow h-[30rem] flex flex-col">
                                <div className="flex-grow overflow-y-auto mb-4 space-y-4 pr-2">
                                    {chatHistory.map((msg, index) => (
                                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <p className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${msg.role === 'user' ? 'bg-brand-blue text-white rounded-br-none' : 'bg-gray-200 text-gray-800 rounded-bl-none'}`}>
                                                {msg.text}
                                            </p>
                                        </div>
                                    ))}
                                    {loadingState === LoadingState.RESPONDING_CHAT && (
                                        <div className="flex justify-start">
                                            <div className="bg-gray-200 rounded-2xl rounded-bl-none p-4">
                                                <LoadingSpinner className="w-5 h-5 text-gray-500" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <form onSubmit={handleChatSubmit} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        placeholder="Ask a question..."
                                        className="flex-grow p-3 bg-gray-800 text-white border-2 border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition placeholder-gray-400"
                                        disabled={loadingState === LoadingState.RESPONDING_CHAT}
                                        aria-label="Chat input"
                                    />
                                    <button type="submit" className="bg-brand-blue text-white font-semibold px-6 py-2 rounded-lg hover:opacity-90 transition disabled:opacity-50" disabled={!chatInput.trim() || loadingState === LoadingState.RESPONDING_CHAT}>
                                        Send
                                    </button>
                                </form>
                             </div>
                        </div>
                    </div>
                </section>
            )}
            
            {error && (
                <div className="fixed bottom-8 right-8 bg-red-500 text-white p-4 rounded-lg shadow-lg flex items-center gap-4">
                    <p>{error}</p>
                    <button onClick={() => setError(null)} className="text-white hover:bg-red-400 rounded-full p-1" aria-label="Dismiss error">&times;</button>
                </div>
            )}
        </div>
    );
};

export default App;