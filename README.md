# AI Concept Animator

AI Concept Animator is a powerful tool that brings your ideas to life by transforming natural language prompts into captivating animations using the magic of Google's Gemini and Manim. Whether you're a student, educator, or creative professional, this application helps you visualize complex concepts with ease.

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js:** Required for the frontend application.
- **Python:** Necessary for the Manim rendering server.
- **Manim:** The core animation engine. Follow the [official installation guide](https://docs.manim.community/en/stable/installation.html) to set it up.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/ai-concept-animator.git
    cd ai-concept-animator
    ```

2.  **Frontend Setup:**
    ```bash
    npm install
    ```

3.  **Backend Setup:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Google Gemini API Key:**
    -   Enable the Generative Language API in your Google Cloud project.
    -   Create a service account and download the JSON key.
    -   Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of your service account key file.

    For Windows (PowerShell):
    ```powershell
    $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\your\service-account-key.json"
    ```

### Running the Application

To run the AI Concept Animator, you need to start both the backend and frontend servers in separate terminals.

1.  **Start the Backend Server:**
    Open a terminal or PowerShell window, navigate to the project's root directory, and run the following command:
    ```bash
    python manim_server.py
    ```
    You should see output indicating that the FastAPI server is running, typically on `http://127.0.0.1:8000`.

2.  **Start the Frontend Application:**
    Open a *second* terminal or PowerShell window, navigate to the same project directory, and run:
    ```bash
    npm run dev
    ```
    The terminal will display a local URL (usually `http://localhost:5173`). Open this URL in your web browser to use the application.

## ⚙️ How It Works

The AI Concept Animator consists of two main components:

-   **React Frontend:** A user-friendly interface where you can input your animation prompts.
-   **FastAPI Backend:** A Python server that receives prompts, uses Google Gemini to generate Manim animation code, and renders the final video.

When you enter a prompt, the frontend sends it to the backend. The backend then queries the Gemini API to convert your text into Python code for Manim. This code is used to render an animation, which is then displayed in the browser.

## Usage

1.  Enter a descriptive prompt for the animation you want to create in the text area.
2.  Click the "Animate" button.
3.  Watch as your idea is transformed into an animation!

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features or improvements, feel free to open an issue or submit a pull request.

