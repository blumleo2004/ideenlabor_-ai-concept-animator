import type { AnimationGenerationResult } from '../types';

// This function calls our backend to generate an animation from a text prompt.
export const generateAnimationFromPrompt = async (prompt: string, signal?: AbortSignal): Promise<AnimationGenerationResult> => {
    try {
        // The backend runs on port 8000
        const response = await fetch('http://localhost:8000/render', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            signal,
            // We send the prompt in the format the backend expects for 'prompt' mode
            body: JSON.stringify({
                mode: 'prompt',
                prompt: prompt,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error("Backend error:", errorBody);
            // Construct a more informative error message
            let message = "The backend failed to render the animation.";
            if (typeof errorBody.detail === 'string') {
                message = errorBody.detail;
            } else if (errorBody.detail?.message) {
                message = errorBody.detail.message;
            }
            throw new Error(message);
        }

        const result = await response.json();

        // The backend returns the generated Manim code and the video URL.
        return {
            manimCode: result.manim_code,
            // The new backend doesn't generate explanations, so we provide a default message.
            explanationScript: "{}", // Empty JSON object for explanations
            initialChatMessage: "I've created this animation and code for you. Let me know if you have questions!",
            // The video URL is now correctly prefixed for the local server.
            videoUrl: `http://localhost:8000${result.download_url}`
        };

    } catch (error) {
        console.error("Error communicating with backend:", error);
        // Provide a user-friendly error message for network issues.
        if (error instanceof DOMException && (error as any).name === 'AbortError') {
            throw new Error('Request cancelled by user.');
        }
        if (error instanceof TypeError) {
            throw new Error("Could not connect to the local animation server. Is it running?");
        }
        throw error; // Re-throw other types of errors
    }
};
