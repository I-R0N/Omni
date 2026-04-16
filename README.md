<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Omni

A modular 2D game engine featuring a multi-layered universe map system
(Universe → Solar → Local → Sub), dynamic rendering, and structured
subsystems.

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Deploying to Netlify

1. Use the CLI via npx (no install needed): `npx netlify-cli login`
2. Optional: `npx netlify-cli init` to link the repo (or use the Netlify UI and connect the Git repo).
3. Build locally: `npm run build`
4. Deploy: `npx netlify-cli deploy --prod --dir=dist`

The included `netlify.toml` already sets the build command (`npm run build`) and publish directory (`dist`). In the Netlify UI, set Build command = `npm run build` and Publish directory = `dist`. For dev preview, `npx netlify-cli dev` will proxy Vite (configured on port 8888).
