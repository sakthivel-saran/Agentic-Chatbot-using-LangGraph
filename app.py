"""Vercel Python API for the static Agentic Chatbot interface."""

import json
import os
import tempfile
import uuid
import base64
from pathlib import Path

from http.server import BaseHTTPRequestHandler

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command

from backend import chatbot, get_all_threads, ingest_rag_document


def _message_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            item.get("text", "") if isinstance(item, dict) else str(item)
            for item in content
        )
    return str(content)


def _pending_interrupt(thread_id):
    try:
        snapshot = chatbot.get_state(
            {"configurable": {"thread_id": thread_id}}
        )
    except Exception:
        return None

    interrupts = getattr(snapshot, "interrupts", ()) or ()
    if interrupts:
        return interrupts[0]
    for task in getattr(snapshot, "tasks", ()) or ():
        interrupts = getattr(task, "interrupts", ()) or ()
        if interrupts:
            return interrupts[0]
    return None


def _conversation(thread_id):
    snapshot = chatbot.get_state(
        {"configurable": {"thread_id": thread_id}}
    )
    messages = []
    for message in snapshot.values.get("messages", []):
        if isinstance(message, HumanMessage):
            role = "user"
        elif isinstance(message, AIMessage):
            role = "assistant"
        else:
            continue
        messages.append({"role": role, "content": _message_text(message.content)})
    interrupt = _pending_interrupt(thread_id)
    return {
        "thread_id": thread_id,
        "messages": messages,
        "pending_approval": (
            {"prompt": str(interrupt.value)} if interrupt is not None else None
        ),
    }


def _run_graph(thread_id, input_value, resume=False):
    config = {
        "configurable": {"thread_id": thread_id},
        "metadata": {"thread_id": thread_id},
        "run_name": "hitl_resume_trace" if resume else "chat_trace",
    }
    graph_input = Command(resume=input_value) if resume else {
        "messages": [HumanMessage(content=input_value)]
    }
    chunks = chatbot.stream(graph_input, config=config, stream_mode="messages")
    assistant_parts = []
    tools_used = []
    for message, _metadata in chunks:
        if isinstance(message, ToolMessage):
            name = getattr(message, "name", None)
            if name and name not in tools_used:
                tools_used.append(name)
        elif isinstance(message, AIMessage) and message.content:
            assistant_parts.append(_message_text(message.content))
    return {
        "reply": "".join(assistant_parts),
        "tools_used": tools_used,
        "pending_approval": (
            {"prompt": str(_pending_interrupt(thread_id).value)}
            if _pending_interrupt(thread_id) is not None
            else None
        ),
    }


def _response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


class handler(BaseHTTPRequestHandler):
    """Vercel serverless function entry point."""

    def do_OPTIONS(self):
        _response(self, 204, {})

    def do_GET(self):
        try:
            if self.path.split("?", 1)[0] == "/api/threads":
                _response(self, 200, {"threads": get_all_threads()})
                return
            if self.path.split("?", 1)[0] == "/api/health":
                missing = [
                    key for key in ("GROQ_API_KEY",)
                    if not os.getenv(key, "").strip()
                ]
                _response(self, 200, {"ok": True, "missing_keys": missing})
                return
            _response(self, 404, {"error": "Not found"})
        except Exception as error:
            _response(self, 500, {"error": str(error)})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 12 * 1024 * 1024:
                _response(self, 413, {"error": "Request exceeds the 12 MB limit."})
                return
            data = json.loads(self.rfile.read(length) or b"{}")
            path = self.path.split("?", 1)[0]

            if path == "/api/chat":
                text = str(data.get("message", "")).strip()
                if not text:
                    _response(self, 400, {"error": "Enter a message first."})
                    return
                thread_id = str(data.get("thread_id") or uuid.uuid4())
                result = _run_graph(thread_id, text)
                _response(self, 200, {"thread_id": thread_id, **result})
                return

            if path == "/api/approve":
                decision = "yes" if data.get("decision") == "yes" else "no"
                thread_id = str(data.get("thread_id", ""))
                if not thread_id or _pending_interrupt(thread_id) is None:
                    _response(self, 409, {"error": "No pending approval for this chat."})
                    return
                result = _run_graph(thread_id, decision, resume=True)
                _response(self, 200, {"thread_id": thread_id, **result})
                return

            if path == "/api/conversation":
                thread_id = str(data.get("thread_id", ""))
                if not thread_id:
                    _response(self, 400, {"error": "A thread ID is required."})
                    return
                _response(self, 200, _conversation(thread_id))
                return

            if path == "/api/upload":
                filename = Path(str(data.get("filename", "document.pdf"))).name
                encoded = data.get("content_base64", "")
                content = base64.b64decode(encoded, validate=True)
                if not filename.lower().endswith(".pdf"):
                    _response(self, 400, {"error": "Only PDF uploads are supported."})
                    return
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as file:
                    file.write(content)
                    path = file.name
                try:
                    ingest_rag_document(path)
                finally:
                    os.unlink(path)
                _response(self, 200, {"message": f"{filename} processed."})
                return

            _response(self, 404, {"error": "Not found"})
        except Exception as error:
            _response(self, 500, {"error": str(error)})

    def log_message(self, _format, *_args):
        return
