<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# sleevesnap

This repository contains the sleevesnap app and backend API.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Start the API server (terminal 1):
   `npm run dev:server`
3. Start the frontend (terminal 2):
   `npm run dev`
4. Run the backend API in another terminal:
   `npm run dev:server`

The frontend runs on port `3000` and proxies `/api` to the backend on port `3001`.
