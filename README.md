# llmEval

A minimalistic, LLM-first evaluation harness for LLM applications, written in TypeScript.

Build test datasets (manually, by import, or synthetically), attach ground truths, run them against
any model (Anthropic, OpenAI, Ollama via LangChain.js), capture outputs and metadata, score, and compare.
Everything is exposed over MCP so it can be driven from Claude Code; a small web UI sits on the same API.

Status: bootstrapping. See `CLAUDE.md` for the development plan and conventions once it lands.
