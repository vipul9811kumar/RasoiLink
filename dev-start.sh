#!/bin/bash
echo "Starting PostgreSQL..."
sudo service postgresql start

echo "Starting Match Engine on port 3001..."
cd /workspaces/RasoiLink/match-engine && npm run dev &

echo "Starting API on port 3000..."
cd /workspaces/RasoiLink/api && npm run dev
