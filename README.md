# Agentic Chatbot

A browser based chat interface powered by LangGraph, with web search, weather, calculator, stock tools, PDF question answering, and approval prompts for stock purchases.

## Run locally

1. Create a Python 3.11 environment and install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Set `GROQ_API_KEY`, `GOOGLE_API_KEY`, and the optional tool keys in `.env`.

3. Install the Vercel CLI and run the static frontend and Python function together:

   ```bash
   vercel dev
   ```

## Deploy to Vercel

Import the repository in Vercel and add the required environment variables: `GROQ_API_KEY` and `GOOGLE_API_KEY`. Add `TAVILY_API_KEY` and `OPENWEATHER_API_KEY` to enable those tools. The project serves the HTML, CSS, and JavaScript from `public/` and routes `/api/*` to the Python function in `app.py`.

Vercel functions are stateless and may scale to separate instances. This demo keeps checkpoints and PDF indexes in process memory, so they can disappear on a cold start and are not shared across instances. Use a persistent LangGraph checkpointer and hosted vector store for durable multi-user history and documents.
