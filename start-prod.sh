#!/bin/sh

# 1. Start the Python FastAPI backend internally on port 8000
echo "Starting Python FastAPI backend on 127.0.0.1:8000..."
cd python-service
uvicorn main:app --host 127.0.0.1 --port 8000 &
cd ..

# 2. Start the TanStack Start Node server on the port assigned by Render
echo "Starting TanStack Start frontend..."
export PORT=${PORT:-3000}
node .output/server/index.mjs
