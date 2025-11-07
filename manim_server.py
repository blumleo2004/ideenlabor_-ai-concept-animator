import os
import uuid
import shutil
import subprocess
from pathlib import Path
from typing import Optional
import logging
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import FileResponse

# --- Logging Configuration ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
# --- End Logging Configuration ---

# Use the official Google Generative AI library
try:
    import google.generativeai as genai
    from google.auth import exceptions as google_auth_exceptions
except ImportError:
    genai = None  # We'll handle the error if prompt-mode is used without this package


ROOT = Path(__file__).parent.resolve()
RENDERS_DIR = ROOT / "renders"
RENDERS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Manim Render Server")

# Allow local frontend (Vite default ports)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://127.0.0.1:5173", 
        "http://localhost:3000", 
        "http://127.0.0.1:3000",
        "http://localhost:3001", # Add the new port
        "http://127.0.0.1:3001", # Add the new port
        "http://192.168.1.74:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# Add logging middleware to debug requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Incoming request: {request.method} {request.url}")
    logger.info(f"Headers: {dict(request.headers)}")
    try:
        response = await call_next(request)
        logger.info(f"Response status: {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"Error processing request: {e}", exc_info=True)
        raise


class RenderRequest(BaseModel):
    mode: str = "code"
    scene_code: Optional[str] = None
    scene_name: Optional[str] = "GeneratedScene"
    quality: Optional[str] = "h"
    prompt: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok"}


def _find_rendered_mp4(scene_name: str) -> Optional[Path]:
    """Search the manim `media` folder for an mp4 containing the scene name and return the newest match."""
    media_dir = ROOT / "media"
    if not media_dir.exists():
        return None
    candidates = list(media_dir.rglob(f"*{scene_name}*.mp4"))
    if not candidates:
        candidates = list(media_dir.rglob("*.mp4"))
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def _find_scene_class(code: str) -> Optional[str]:
    """Find the name of the Manim Scene class in the generated code."""
    # Regex to find a class that inherits from Scene, ThreeDScene, etc.
    match = re.search(r"class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*(?:ThreeD|Zoomed|MovingCamera)?Scene\s*\):", code)
    if match:
        return match.group(1)
    return None


def _call_gemini(prompt: str, model: str = "gemini-2.5-pro") -> str:
    """Calls the Gemini API to generate Manim code from a prompt."""
    if genai is None:
        raise RuntimeError(
            "The 'google-generativeai' package is required. "
            "Please install it with: pip install google-generativeai"
        )

    try:
        # Explicitly set the credentials for this call
        key_path = ROOT / "service-account-key.json"
        if not key_path.exists():
            raise ValueError("Service account key 'service-account-key.json' not found.")
        
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(key_path)

        # With the environment variable set, the library will find the credentials.
        model = genai.GenerativeModel(model)

    except google_auth_exceptions.DefaultCredentialsError:
        raise ValueError(
            "Google Cloud authentication failed. This can be due to an invalid service account key."
        )
    except Exception as e:
        # Catch other potential init errors
        raise RuntimeError(f"Failed to initialize Gemini: {e}")

    # A more detailed prompt for better results
    full_prompt = f"""
You are an expert programmer specializing in the Manim Community library (the modern, community-maintained version of Manim).
Your sole task is to generate a single, complete, and runnable Python script for a Manim animation based on a user's request.

**User Request:** "{prompt}"

**CRITICAL INSTRUCTIONS:**
1.  **Use Manim Community Syntax:** Your code MUST be compatible with the latest version of the Manim Community library. Do not use outdated syntax from older versions.
2.  **Complete Script:** Provide a full script. This means it must start with `from manim import *` and contain a class that inherits from `Scene`.
3.  **Class Naming:** The main animation class MUST be named `GeneratedScene`. For example: `class GeneratedScene(Scene):`.
4.  **`construct` Method:** All animation logic must be within the `construct(self)` method of the `GeneratedScene` class.
5.  **Code Only:** Your entire response must be ONLY the Python code. Do not add any explanations, comments, or markdown formatting like ```python. Just raw Python code.
6.  **Clarity and Focus:** The animation should be clear, directly address the user's prompt, and avoid unnecessary complexity. Focus on creating a short, elegant animation that demonstrates the core concept.
7.  **Common Mobjects:** Use standard Mobjects like `Circle`, `Square`, `Line`, `Text`, `MathTex`, etc., where appropriate.
8.  **Animation Flow:** Use `self.play()` to show animations. You can chain animations with `self.play(Animation1(...), Animation2(...))` for simultaneous effects or use multiple `self.play()` calls for sequential steps. Use `Wait()` to add pauses.

**EXAMPLE:**

**User Request:** "Show a blue circle turning into a red square."

**Your Response (raw code):**
from manim import *

class GeneratedScene(Scene):
    def construct(self):
        circle = Circle(color=BLUE)
        square = Square(color=RED)
        self.play(Create(circle))
        self.wait(1)
        self.play(Transform(circle, square))
        self.wait(1)
        self.play(FadeOut(circle))

"""

    try:
        response = model.generate_content(full_prompt)
        # Clean up the response to get only the code
        generated_text = response.text
        if "```python" in generated_text:
            generated_text = generated_text.split("```python")[1].split("```")[0]
        return generated_text.strip()
    except Exception as e:
        raise RuntimeError(f"Error calling Gemini API: {e}")


@app.options("/render")
def render_options():
    """Handle CORS preflight request for /render endpoint."""
    return {"status": "ok"}


@app.post("/render")
def render(req: RenderRequest):
    """
    Renders a Manim scene.
    - In 'code' mode, it runs the provided code.
    - In 'prompt' mode, it first generates code from the prompt using Gemini, then runs it.
    """
    scene_code = req.scene_code
    scene_name = req.scene_name
    quality_flag = f"-q{req.quality}"

    logger.info(f"Received render request in '{req.mode}' mode.")

    # In prompt mode, we generate the code first
    if req.mode == "prompt":
        if not req.prompt:
            raise HTTPException(status_code=400, detail="A prompt is required for 'prompt' mode.")
        try:
            # Generate the Manim code from the user's prompt
            logger.info(f"Generating Manim code for prompt: '{req.prompt[:50]}...'")
            generated_code = _call_gemini(req.prompt)
            scene_code = generated_code
            # Dynamically find the scene name instead of hardcoding it
            found_scene_name = _find_scene_class(generated_code)
            if not found_scene_name:
                logger.error("Could not find a Scene class in the generated code.")
                raise HTTPException(status_code=500, detail="AI failed to generate a valid Manim scene class.")
            scene_name = found_scene_name
            logger.info(f"Successfully generated Manim code. Found scene: '{scene_name}'")
        except (RuntimeError, ValueError) as e:
            logger.error(f"Error during Gemini API call: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    if not scene_code:
        raise HTTPException(status_code=400, detail="No scene code provided.")

    # If we are in 'code' mode, we still need to find the scene name
    if req.mode == "code" and not req.scene_name:
        found_scene_name = _find_scene_class(scene_code)
        if not found_scene_name:
            raise HTTPException(status_code=400, detail="Could not automatically detect a Scene class. Please provide a scene_name.")
        scene_name = found_scene_name
        logger.info(f"Auto-detected scene name for 'code' mode: '{scene_name}'")


    # --- Manim execution ---
    unique_id = uuid.uuid4().hex
    py_filename = f"scene_{unique_id}.py"
    py_filepath = ROOT / py_filename

    with open(py_filepath, "w", encoding="utf-8") as f:
        f.write(scene_code)
    
    logger.info(f"Wrote scene code to temporary file: {py_filename}")

    # Clean up old media files before running to ensure we get the new one
    if os.path.exists(ROOT / "media"):
        logger.info("Cleaning up old media files.")
        shutil.rmtree(ROOT / "media")

    try:
        # Execute Manim using a subprocess with a 60-second timeout
        logger.info(f"Executing Manim for scene '{scene_name}'...")
        result = subprocess.run(
            ["manim", str(py_filepath), scene_name, quality_flag, "--format=mp4"],
            capture_output=True,
            text=True,
            check=True,
            encoding="utf-8",
            timeout=120  # Add a 120-second timeout
        )
        logger.info("Manim execution successful.")
        logger.debug("Manim STDOUT:\n" + result.stdout)
    except subprocess.TimeoutExpired as e:
        logger.error("Manim execution timed out.", exc_info=True)
        os.remove(py_filepath)
        raise HTTPException(
            status_code=500,
            detail={"message": "The animation rendering took too long and was stopped. Try a simpler prompt."},
        )
    except subprocess.CalledProcessError as e:
        logger.error("Manim execution failed.", exc_info=True)
        logger.error("Manim STDERR:\n" + e.stderr)
        if e.stdout:
            logger.error("Manim STDOUT:\n" + e.stdout)
        # Clean up the generated python file
        os.remove(py_filepath)
        raise HTTPException(
            status_code=500,
            detail={"message": "Failed to render Manim animation.", "log": e.stderr},
        )

    # Find the rendered video file
    final_video_path = _find_rendered_mp4(scene_name)
    if not final_video_path:
        logger.error(f"Could not find rendered MP4 for scene '{scene_name}'.")
        os.remove(py_filepath)
        raise HTTPException(status_code=404, detail="Rendered video file not found.")

    logger.info(f"Found rendered video: {final_video_path.name}")

    # --- File handling ---
    # Move the final video to the public renders directory
    render_filename = f"render_{unique_id}.mp4"
    final_render_path = RENDERS_DIR / render_filename
    shutil.move(final_video_path, final_render_path)

    # Clean up the temporary python file and the manim media directory
    logger.info(f"Cleaning up temporary files: {py_filename} and media directory.")
    os.remove(py_filepath)
    if os.path.exists(ROOT / "media"):
        shutil.rmtree(ROOT / "media")

    download_url = f"/renders/{render_filename}"

    logger.info(f"Successfully created render: {render_filename}")

    # For prompt mode, we return the generated code as well
    if req.mode == "prompt":
        return {
            "download_url": download_url,
            "manim_code": scene_code,
            "explanation_script": "{}"  # Return a valid empty JSON object string
        }

    return {"download_url": download_url}


@app.get("/renders/{filename}")
def get_render(filename: str):
    """Serves the rendered video file."""
    file_path = RENDERS_DIR / filename
    logger.info(f"Serving file: {file_path}")
    if not file_path.is_file():
        logger.error(f"File not found request: {filename}")
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(str(file_path))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
